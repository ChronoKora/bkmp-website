-- Bkmp - Fix: Drachenlager-Erweiterungen (Kapazitaet) waren NIE serverseitig
-- gespeichert, nur in localStorage - dadurch auf jedem Geraet ein komplett
-- unabhaengiger Stand, obwohl das echtes, mit Gold bezahltes Fortschritt
-- ist (Spieler-Meldung, 06.08.2026, "Kaledoss": 27 Plaetze auf dem Handy,
-- 67 Plaetze am PC). Root Cause: bkmpDragonStorageExpansionsBought()/
-- bkmpDragonExpandStorage() (js/systems/bkmp-breeding.js) lasen/schrieben
-- ausschliesslich localStorage.getItem/setItem('bkmp-dragon-storage-
-- expansions') - nie Teil von idle_player_state, nie synchronisiert.
--
-- Gleiches additive Muster wie obstgarten_level/jagdhuette_level
-- (sql/supabase-dragon-breeding.sql) - kleine, dauerhafte integer-Spalte
-- auf der bestehenden idle_player_state-Tabelle, kein neues Schema.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_player_state
  add column if not exists dragon_storage_expansions_bought integer not null default 0;

comment on column public.idle_player_state.dragon_storage_expansions_bought is
  'Anzahl gekaufter Drachenlager-Erweiterungen (max. 5, siehe BKMP_DRAGON_STORAGE_EXPANSIONS in js/systems/bkmp-breeding.js). Ersetzt das fruehere, rein lokale localStorage-Feld "bkmp-dragon-storage-expansions" - Client migriert bereits vorhandene lokale Werte einmalig automatisch (siehe bkmpDragonMigrateStorageExpansionsFromLocalStorage).';
