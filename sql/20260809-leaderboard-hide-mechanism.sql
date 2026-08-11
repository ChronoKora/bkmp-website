-- Bkmp - Auffaellige Accounts oeffentlich von der Bestenliste ausblenden,
-- fuer den Admin aber weiterhin vollstaendig sichtbar (Nutzerwunsch 09.08.2026,
-- direkte Folge der Anti-Cheat-Recherche vom selben Tag - "hide first, decide
-- later" ist der uebereinstimmende Rat aus praktisch jeder recherchierten
-- Quelle fuer kleine Projekte, siehe Chat).
--
-- ZWEI unabhaengige Ausblend-Gruende, beide fuehren zum selben Ergebnis:
-- 1) MANUELL: du traegst einen Namen von Hand ein (fuer die bereits bekannten
--    Faelle wie im Screenshot, die AELTER sind als der gestrige Trigger und
--    deshalb noch keinen automatischen Eintrag haben).
-- 2) AUTOMATISCH: sobald der (gestern erweiterte) Anti-Cheat-Trigger
--    kuenftig einen Verstoss protokolliert (idle_anticheat_flags), wird der
--    betroffene Account automatisch mit ausgeblendet - ohne dass du jeden
--    Fall einzeln eintragen musst. Ein einzelner Alarm hebt NICHT sofort
--    einen vermeintlich falschen Alarm auf - dafuer gibt es die neue
--    "dismissed"-Spalte, die du im Admin-Panel pro Alarm setzen kannst.
--
-- WICHTIG (Reihenfolge): diese Datei baut auf idle_anticheat_flags auf
-- (sql/20260730-idle-player-state-anticheat-guard.sql). Falls diese noch nie
-- ausgefuehrt wurde, fehlt die Tabelle - bitte VORHER (oder direkt danach,
-- Reihenfolge ist bei "create table if not exists" hier egal) einmal
-- ausfuehren.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

-- ============================================================
-- 1) Manuelle Ausblend-Liste (nur Admin darf lesen/schreiben - bewusst KEINE
--    anon/authenticated-Select-Policy, damit niemand von aussen - auch nicht
--    per direkter REST-Abfrage - herausfinden kann, wer gerade verdaechtigt
--    wird. Das waere sonst selbst ein Datenleck: "wer steht auf der
--    Verdaechtigen-Liste" ist Admin-only-Information.)
-- ============================================================
create table if not exists public.idle_leaderboard_hidden_accounts (
  name_key text primary key,
  reason text not null default '',
  hidden_by text,
  hidden_at timestamptz not null default now()
);
alter table public.idle_leaderboard_hidden_accounts enable row level security;

drop policy if exists "Admin manage hidden leaderboard accounts" on public.idle_leaderboard_hidden_accounts;
create policy "Admin manage hidden leaderboard accounts" on public.idle_leaderboard_hidden_accounts
  for all to authenticated using (public.is_active_admin()) with check (public.is_active_admin());

-- ============================================================
-- 2) idle_anticheat_flags bekommt eine "geprueft/falscher Alarm"-Spalte -
--    ein einzelner Alarm blendet automatisch aus, "dismissed=true" hebt das
--    wieder auf (OHNE den historischen Log-Eintrag zu loeschen).
-- ============================================================
alter table public.idle_anticheat_flags add column if not exists dismissed boolean not null default false;
alter table public.idle_anticheat_flags add column if not exists dismissed_by text;
alter table public.idle_anticheat_flags add column if not exists dismissed_at timestamptz;

-- Admin darf jetzt auch UPDATEN (bisher nur SELECT erlaubt), damit "dismissed"
-- im Admin-Panel gesetzt werden kann. Kein INSERT/DELETE-Grant fuer Clients -
-- neue Eintraege schreibt weiterhin ausschliesslich der Trigger.
drop policy if exists "Admin update anticheat flags" on public.idle_anticheat_flags;
create policy "Admin update anticheat flags" on public.idle_anticheat_flags
  for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());

-- ============================================================
-- 3) Oeffentliche Bestenlisten-Sicht: identische Spalten wie der bisherige
--    direkte Zugriff auf idle_player_state (siehe loadIdleLeaderboardStats()
--    in supabase.js), aber Zeilen mit einem manuellen Ausblend-Eintrag ODER
--    einem NICHT abgehakten Anti-Cheat-Alarm fehlen einfach - unauffaellig,
--    kein Hinweis "hier fehlt jemand", genau wie bei einem normal niedrigen
--    Rang. Server-seitig gefiltert (nicht nur im Client-JS versteckt), damit
--    eine direkte REST-Abfrage die versteckten Zeilen ebenfalls nicht sieht.
-- ============================================================
-- WICHTIG: bewusst OHNE security_invoker=true (Postgres-Standardverhalten
-- fuer Views, "laeuft mit den Rechten des Erstellers"). Der Grund: die
-- WHERE-NOT-EXISTS-Unterabfragen unten muessen idle_leaderboard_hidden_
-- accounts/idle_anticheat_flags lesen koennen, obwohl anon/authenticated
-- dort explizit KEINE eigene Select-Policy haben (Admin-only, siehe oben) -
-- mit security_invoker=true wuerden diese Unterabfragen fuer einen
-- anonymen Aufrufer leer erscheinen und die gesamte Ausblend-Logik damit
-- wirkungslos machen. Die View selbst gibt trotzdem NUR die bereits
-- gefilterten idle_player_state-Spalten zurueck, nie den Inhalt der beiden
-- geschuetzten Tabellen - kein Leck, nur die (bereits oeffentliche, siehe
-- bestehende RLS auf idle_player_state) Bestenlisten-Daten, jetzt um die
-- versteckten Zeilen bereinigt.
create or replace view public.idle_player_state_leaderboard
as
select s.name_key, s.display_name, s.level, s.total_gold_earned, s.dragon_kills,
       s.playtime_seconds, s.highest_dragon_index, s.prestige_stage_offset, s.turm_highest_wave
from public.idle_player_state s
where not exists (
  select 1 from public.idle_leaderboard_hidden_accounts h where h.name_key = s.name_key
)
and not exists (
  select 1 from public.idle_anticheat_flags f where f.name_key = s.name_key and f.dismissed = false
);

grant select on public.idle_player_state_leaderboard to anon, authenticated;
