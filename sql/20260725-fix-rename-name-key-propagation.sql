-- Bkmp - Bugfix: rename_player_account() liess idle_player_runes/
-- idle_prestige_state/idle_player_village_skins bei einer Namensaenderung
-- unangetastet zurueck.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Anlass (25.07.2026, kritischer Nutzerbericht): "Meine Runen sind komplett
-- weg. Das waren teilweise schon Level-22- und Level-23-Runen." Ursache
-- (per Quellcode-Analyse bewiesen): die aktuelle Fassung von
-- rename_player_account() (zuletzt per "create or replace function" in
-- sql/supabase-player-name-blocklist.sql definiert, davor v2/v3) aktualisiert
-- name_key in player_stats/idle_player_state/user_plushies/auth.users - aber
-- NICHT in idle_player_runes, idle_prestige_state und idle_player_village_
-- skins. supabase.js's loadPlayerRunes()/loadIdlePrestigeState()/
-- loadPlayerVillageSkins() filtern beim Laden jeweils STRIKT nach name_key
-- (kein auth_user_id-Fallback) - nach einer Namensaenderung zeigt der
-- naechste Ladevorgang (Tab neu geoeffnet, Seite neu geladen) diese drei
-- Systeme deshalb leer an, obwohl die Zeilen unter dem ALTEN name_key
-- unveraendert in der Datenbank stehen. KEIN echter Datenverlust, aber ohne
-- diesen Fix fuer den Spieler nicht von einem unterscheidbar - siehe
-- CLAUDE.md fuer den vollen Bugfix-Bericht.
--
-- Fix: exakt dieselben drei zusaetzlichen UPDATE-Anweisungen wie bereits fuer
-- idle_player_state/user_plushies vorhanden, nur fuer die drei bisher
-- uebersehenen Tabellen ergaenzt. idle_prestige_state/idle_player_village_
-- skins haben kein auth_user_id auf Zeilenebene, das eindeutig genug waere
-- (idle_prestige_state hat gar keine auth_user_id-Spalte) - deshalb wie im
-- Rest der Funktion ueber den alten name_key (v_old_row.name_key) gefiltert,
-- exakt wie beim bereits bestehenden user_plushies-Update.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich (create or replace
-- function, keine Datenaenderung beim reinen Ausfuehren dieser Datei -
-- die UPDATEs laufen nur, wenn ein Spieler sich als naechstes tatsaechlich
-- umbenennt).

create or replace function public.rename_player_account(p_new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new_name text := trim(p_new_name);
  v_new_key text := lower(v_new_name);
  v_old_row public.player_stats%rowtype;
  v_conflict_owner uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_new_key = '' or length(v_new_key) > 32 then
    raise exception 'invalid_name';
  end if;
  if public.is_name_blocked(v_new_name) then
    raise exception 'name_blocked';
  end if;

  select * into v_old_row from public.player_stats where auth_user_id = v_uid limit 1;
  if not found then
    raise exception 'no_account';
  end if;

  if v_old_row.name_key = v_new_key then
    raise exception 'same_name';
  end if;

  if v_old_row.last_name_change_at is not null and v_old_row.last_name_change_at > now() - interval '30 days' then
    raise exception 'cooldown_active';
  end if;

  select auth_user_id into v_conflict_owner from public.player_stats where name_key = v_new_key limit 1;
  if found and v_conflict_owner is distinct from v_uid then
    raise exception 'name_taken';
  end if;

  insert into public.player_name_history (auth_user_id, old_name, new_name)
  values (v_uid, v_old_row.display_name, v_new_name);

  update public.player_stats
  set name_key = v_new_key, display_name = v_new_name, last_name_change_at = now()
  where auth_user_id = v_uid;

  update public.idle_player_state
  set name_key = v_new_key, display_name = v_new_name
  where auth_user_id = v_uid;

  update public.user_plushies
  set name_key = v_new_key, display_name = v_new_name
  where name_key = v_old_row.name_key;

  -- NEU (25.07.2026-Fix): dieselben drei Systeme, die bisher bei einer
  -- Namensaenderung uebersehen wurden.
  update public.idle_player_runes
  set name_key = v_new_key
  where name_key = v_old_row.name_key;

  update public.idle_prestige_state
  set name_key = v_new_key, display_name = v_new_name
  where name_key = v_old_row.name_key;

  update public.idle_player_village_skins
  set name_key = v_new_key
  where name_key = v_old_row.name_key;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', v_new_name)
  where id = v_uid;
end;
$$;
grant execute on function public.rename_player_account(text) to authenticated;

-- ============================================================
-- Einmaliges Backfill fuer BEREITS betroffene Spieler (Zeilen, deren
-- name_key nicht mehr zu ihrer aktuellen player_stats-Zeile passt, weil sie
-- sich VOR diesem Fix schon einmal umbenannt haben). Rein additiv/
-- korrigierend (UPDATE auf den bereits korrekten player_stats-Stand, keine
-- Loeschung, keine Werteaenderung ausser name_key/display_name) - siehe
-- CLAUDE.md-Bericht fuer die Empfehlung, dies erst nach Pruefung im
-- Dashboard auszufuehren.
--
-- NACHBESSERUNG (25.07.2026, echter Fehlschlag beim ersten Ausfuehrungs-
-- versuch: "duplicate key value violates unique constraint idle_player_
-- runes_one_equipped_per_type", Key (thiano, slot3)): ein Spieler, der sich
-- VOR diesem Fix mehrfach umbenannt hat, kann unter mehreren alten Namen
-- JEWEILS eine eigene ausgeruestete Rune desselben Typs haben (jede alte
-- Namensversion hatte ihren eigenen, lokal gueltigen "eine ausgeruestet pro
-- Typ"-Zustand, siehe sql/20260718-fix-rune-duplicate-equip.sql). Ein
-- blindes Zusammenfuehren aller alten Namen auf den aktuellen Namen in
-- einem Schritt kollidiert dann mit genau dieser Regel. Schritt A loest das
-- VORAB - identische Bereinigungslogik wie 20260718 (rechnerisch staerkste
-- Rune bleibt ausgeruestet: Hauptwert*(1+Aufwertungsstufe*0.08), bei
-- Gleichstand die aeltere Zeile), nur diesmal ueber ALLE Namensversionen
-- desselben Spielers (auth_user_id) hinweg statt nur innerhalb eines
-- einzelnen name_key. Fuer die grosse Mehrheit der Spieler (nie umbenannt,
-- oder nur einmal ohne Konflikt) aendert Schritt A nichts - rein additive
-- Absicherung, kein Risiko fuer bereits korrekte Spielstaende.
-- ============================================================

-- Schritt A: Ausruestungs-Konflikte VOR dem Zusammenfuehren aufloesen.
with target as (
  select
    r.id,
    row_number() over (
      partition by ps.auth_user_id, r.rune_type
      order by (r.rolled_value * (1 + r.upgrade_level * 0.08)) desc, r.created_at asc
    ) as rn
  from public.idle_player_runes r
  join public.player_stats ps on ps.auth_user_id = r.auth_user_id
  where r.equipped = true
)
update public.idle_player_runes r
set equipped = false
from target
where r.id = target.id
  and target.rn > 1;

-- Schritt B: jetzt konfliktfrei - name_key auf den aktuellen Stand ziehen.
update public.idle_player_runes r
set name_key = ps.name_key
from public.player_stats ps
where r.auth_user_id = ps.auth_user_id
  and r.name_key is distinct from ps.name_key;

update public.idle_player_village_skins v
set name_key = ps.name_key
from public.player_stats ps
where v.auth_user_id = ps.auth_user_id
  and v.name_key is distinct from ps.name_key;

-- idle_prestige_state hat keine auth_user_id-Spalte - Backfill laeuft
-- deshalb ueber die player_name_history-Tabelle (jede historische alt-name ->
-- neu-name-Zuordnung, siehe insert oben in derselben Funktion), nicht ueber
-- eine direkte Fremdschluessel-Verknuepfung. Nur Zeilen, deren name_key
-- exakt einem HISTORISCHEN alten Namen entspricht UND fuer die noch keine
-- Zeile unter dem neuesten Namen existiert, werden umbenannt (verhindert
-- eine faelschliche Zusammenfuehrung zweier unabhaengiger Spieler, falls ein
-- alter Name zwischenzeitlich von jemand anderem uebernommen wurde).
update public.idle_prestige_state p
set name_key = h.new_name_key, display_name = h.new_name
from (
  select distinct on (lower(old_name)) lower(old_name) as old_name_key, lower(new_name) as new_name_key, new_name
  from public.player_name_history
  order by lower(old_name), changed_at desc
) h
where p.name_key = h.old_name_key
  and not exists (
    select 1 from public.idle_prestige_state p2 where p2.name_key = h.new_name_key
  );
