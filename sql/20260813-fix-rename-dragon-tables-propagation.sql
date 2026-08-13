-- Bkmp - Bugfix: rename_player_account() liess player_dragons/
-- player_dragon_eggs/player_dragon_nests bei einer Namensaenderung
-- unangetastet zurueck - exakt derselbe Bug wie am 25.07.2026 fuer Runen/
-- Prestige/Dorf-Skins bereits gefunden+gefixt (sql/20260725-fix-rename-
-- name-key-propagation.sql), diesmal fuer die drei Drachenzucht-Tabellen
-- (sql/supabase-dragon-breeding.sql, 17.07.2026), die bei diesem Fix
-- schlicht uebersehen wurden.
--
-- Anlass (13.08.2026, Discord-DM "Moni"): "meine Drachen alle weg sind,
-- die außer die ein anzeigen welche man hat" - Screenshot zeigt
-- "Eierlager: Noch keine Eier im Lager" + "Drachenlager (0/52): Noch keine
-- jugendlichen oder erwachsenen Drachen" (Kapazitaet 52 beweist ECHTE
-- Vorgeschichte - 20 Basis + 30 aus 4 gekauften Lager-Erweiterungen + 2
-- Bonus, kein frischer Account).
--
-- ROOT CAUSE (per direktem curl gegen die echte Produktions-DB bestaetigt,
-- nicht nur vermutet): player_stats-Suche fand genau einen Treffer
-- (name_key='.moni3550', auth_user_id='aaba4b05-c901-4006-99ff-e781294b5121',
-- last_name_change_at='2026-08-12T14:43:20' - eine Umbenennung nur Stunden
-- vor der Meldung). Ihre idle_player_state-Zeile ist unter dem NEUEN Namen
-- vollstaendig gesund (level 4275, dragon_storage_expansions_bought=4,
-- passt exakt zur gemeldeten 52er-Kapazitaet) - player_dragons/
-- player_dragon_eggs/player_dragon_nests unter demselben neuen name_key
-- sind dagegen alle DREI leer ([]). Diese Asymmetrie (idle_player_state
-- gesund, Drachentabellen leer) ist exakt der Fingerabdruck des 25.07.-
-- Bugmusters - grep ueber ALLE vier historischen Fassungen von
-- rename_player_account() (supabase-player-accounts-v2.sql, -v3.sql,
-- supabase-player-name-blocklist.sql, 20260725-fix-rename-name-key-
-- propagation.sql) bestaetigt: player_dragon* taucht in KEINER einzigen
-- davon auch nur ein einziges Mal auf. Kein echter Datenverlust - ihre
-- Zeilen stehen unveraendert unter dem ALTEN name_key in der DB, nur der
-- naechste Ladevorgang (strikt nach aktuellem name_key gefiltert, siehe
-- loadPlayerDragons()/loadPlayerDragonEggs() in supabase.js) findet sie
-- nicht mehr.
--
-- Fix: exakt dasselbe Muster wie am 25.07. - drei zusaetzliche UPDATE-
-- Anweisungen in rename_player_account(), hier bewusst ueber auth_user_id
-- (nicht ueber den alten name_key) gefiltert, da alle drei Tabellen
-- auth_user_id bereits als Spalte fuehren (sql/supabase-dragon-breeding.sql)
-- - robuster als der name_key-Vergleich, den die 25.07.-Fassung fuer Runen/
-- Dorf-Skins genutzt hat, und identisch zum bereits bestehenden
-- idle_player_state-Update direkt darueber in derselben Funktion.
--
-- Backfill braucht (anders als beim 25.07.-Runen-Fall) KEINE vorgeschaltete
-- Konflikt-Aufloesung: die einzigen Eindeutigkeits-Regeln auf diesen drei
-- Tabellen (player_dragon_nests: unique(auth_user_id, slot_index);
-- player_dragons: partial unique index auf (auth_user_id) where
-- is_companion=true, siehe sql/20260805-dragon-multi-companion-slots.sql)
-- haengen NICHT von name_key ab - ein reines Nachziehen von name_key auf
-- den aktuellen player_stats-Stand kann keine davon verletzen.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich. Laeuft in einer
-- expliziten Transaktion (begin/commit) - schlaegt irgendetwas fehl, wird
-- alles zurueckgerollt.

begin;

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

  update public.idle_player_runes
  set name_key = v_new_key
  where name_key = v_old_row.name_key;

  update public.idle_prestige_state
  set name_key = v_new_key, display_name = v_new_name
  where name_key = v_old_row.name_key;

  update public.idle_player_village_skins
  set name_key = v_new_key
  where name_key = v_old_row.name_key;

  -- NEU (13.08.2026-Fix): die drei Drachenzucht-Tabellen, die bei den
  -- 25.07.-Ergaenzungen oben schlicht uebersehen wurden. Ueber auth_user_id
  -- gefiltert (alle drei Tabellen fuehren die Spalte bereits), nicht ueber
  -- den alten name_key - identisches Prinzip wie idle_player_state oben.
  update public.player_dragons
  set name_key = v_new_key
  where auth_user_id = v_uid;

  update public.player_dragon_eggs
  set name_key = v_new_key
  where auth_user_id = v_uid;

  update public.player_dragon_nests
  set name_key = v_new_key
  where auth_user_id = v_uid;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', v_new_name)
  where id = v_uid;
end;
$$;
grant execute on function public.rename_player_account(text) to authenticated;

-- ============================================================
-- Einmaliges Backfill fuer BEREITS betroffene Spieler (u.a. Moni) - reine
-- Korrektur auf den bereits korrekten player_stats-Stand, keine Loeschung,
-- keine sonstige Wertaenderung. Sicher ohne vorgeschaltete Konflikt-
-- Aufloesung (siehe Datei-Kopf-Kommentar - keine der drei Eindeutigkeits-
-- Regeln auf diesen Tabellen haengt von name_key ab).
-- ============================================================

update public.player_dragons d
set name_key = ps.name_key
from public.player_stats ps
where d.auth_user_id = ps.auth_user_id
  and d.name_key is distinct from ps.name_key;

update public.player_dragon_eggs e
set name_key = ps.name_key
from public.player_stats ps
where e.auth_user_id = ps.auth_user_id
  and e.name_key is distinct from ps.name_key;

update public.player_dragon_nests n
set name_key = ps.name_key
from public.player_stats ps
where n.auth_user_id = ps.auth_user_id
  and n.name_key is distinct from ps.name_key;

commit;
