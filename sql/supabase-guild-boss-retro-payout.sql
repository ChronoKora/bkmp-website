-- Einmalige Nachzahlung fuer den am 16.07. gefundenen Gildenboss-Belohnungs-
-- Bug (siehe bkmpGuildBossCheckOutcome-Kommentar in idledorf.js): guild_boss_
-- finish() schrieb Gold/Kristalle bei einem Sieg zwar sofort serverseitig
-- gut, der naechste normale Autosave der Hauptseite ueberschrieb diese
-- Gutschrift aber binnen Sekunden wieder mit dem noch veralteten lokalen
-- Spielstand - die Belohnung war also faktisch fast immer wieder weg.
--
-- Rechnet fuer jede bisher gewonnene Gildenboss-Instanz exakt dieselbe
-- Formel nach wie guild_boss_finish() selbst (Schadensanteil * Beloh-
-- nungspool, auf Basis der HEUTE in guild_bosses hinterlegten gold_reward/
-- gem_reward - falls die Werte zwischenzeitlich im Admin-Bereich geaendert
-- wurden, stimmt das fuer aeltere Kaempfe nicht mehr exakt, ist aber die
-- bestmoegliche verfuegbare Naeherung, da der Pool nicht pro Instanz
-- gespeichert wird) und schreibt die Summe ueber ALLE bisherigen Siege
-- einmalig gut.
--
-- Idempotent/sicher mehrfach ausfuehrbar: markiert jede verarbeitete
-- Instanz per neuer retro_payout_applied_at-Spalte, ein zweiter Lauf
-- ueberspringt bereits abgerechnete Instanzen und zahlt nichts doppelt.
alter table public.guild_boss_instances
  add column if not exists retro_payout_applied_at timestamptz;

do $$
declare
  v_instance record;
begin
  for v_instance in
    select gbi.id as instance_id, gbi.total_damage, gb.gold_reward, gb.gem_reward
    from public.guild_boss_instances gbi
    join public.guild_bosses gb on gb.id = gbi.boss_id
    where gbi.status = 'won' and gbi.retro_payout_applied_at is null
  loop
    update public.idle_player_state ips
    set gold = ips.gold + payout.owed_gold,
        crystals = ips.crystals + payout.owed_gems
    from (
      select gbp.auth_user_id,
             round(v_instance.gold_reward * (gbp.damage_dealt::numeric / greatest(1, v_instance.total_damage))) as owed_gold,
             round(v_instance.gem_reward * (gbp.damage_dealt::numeric / greatest(1, v_instance.total_damage))) as owed_gems
      from public.guild_boss_participants gbp
      where gbp.instance_id = v_instance.instance_id and gbp.damage_dealt > 0
    ) payout
    where ips.auth_user_id = payout.auth_user_id
      and (payout.owed_gold > 0 or payout.owed_gems > 0);

    update public.guild_boss_instances set retro_payout_applied_at = now() where id = v_instance.instance_id;
  end loop;
end $$;

-- Kontroll-Abfrage (optional, danach separat ausfuehren): zeigt, wie viele
-- Instanzen verarbeitet wurden und die Gesamtsumme der Nachzahlung.
-- select count(*) as instanzen, count(*) filter (where retro_payout_applied_at is not null) as bereits_verarbeitet
-- from public.guild_boss_instances where status = 'won';
