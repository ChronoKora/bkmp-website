-- ============================================================
-- Sicherheits-Audit 15.07.: schliesst eine live ausnutzbare Luecke, mit
-- der jeder eingeloggte Spieler sich Echtgeld-Inhalte selbst freischalten
-- oder fremde Spielstaende ueberschreiben konnte. Idempotent (DROP POLICY
-- IF EXISTS + CREATE), gefahrlos mehrfach ausfuehrbar.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- ============================================================

-- ------------------------------------------------------------
-- 1) KRITISCH: idle_player_village_skins erlaubte per "Owner insert
--    player village skins"-Policy (auth_user_id = auth.uid()) JEDEM
--    eingeloggten Spieler, sich selbst eine Besitz-Zeile fuer JEDEN
--    skin_id anzulegen - auch fuer den 1,99EUR-Echtgeld-Skin
--    "drachenrahmen" (unlock_type='real_money'). Das umgeht Stripe
--    komplett: ein simpler REST-POST mit dem eigenen JWT + der oeffentlichen
--    anon-Key reicht, um sich den Kauf gratis selbst zu geben. Der Kauf
--    soll laut supabase-real-money-purchases.sql AUSSCHLIESSLICH per
--    Service-Role im Stripe-Webhook geschrieben werden - die Policy hat
--    das nie technisch erzwungen. Fix: Client-Insert nur noch fuer
--    Skins erlauben, die NICHT unlock_type='real_money' sind (Service-
--    Role umgeht RLS ohnehin immer, also bleibt der Webhook-Pfad
--    unveraendert funktionsfaehig).
-- ------------------------------------------------------------
drop policy if exists "Owner insert player village skins" on public.idle_player_village_skins;
create policy "Owner insert player village skins"
on public.idle_player_village_skins for insert to authenticated
with check (
  auth_user_id = auth.uid()
  and exists (
    select 1 from public.idle_village_skins s
    where s.id = skin_id and s.unlock_type <> 'real_money'
  )
);

-- ------------------------------------------------------------
-- 2) Absicherung idle_player_state: supabase-idle-dorf-schema.sql legte
--    urspruenglich bewusst offene Policies an (anon, using(true)/check(true)),
--    supabase-player-accounts-v2.sql sollte das am 09.07. auf Owner-only
--    umstellen. Mehrere SPAETERE Dateien (u.a. supabase-idle-guilds.sql,
--    supabase-idle-dungeon-leaderboard.sql, beide 14.07.) beschreiben die
--    Tabelle in ihren Kommentaren aber weiterhin als "offene RLS" - das
--    kann veraltete Doku sein, laesst sich von aussen (nur anon-Key) aber
--    nicht sicher unterscheiden. Deshalb hier defensiv nochmal explizit
--    auf Owner-only gesetzt (no-op falls v2/v3 schon lief, echter Fix
--    falls nicht). insert bleibt zusaetzlich fuer den einmaligen
--    Konto-Erstellungsfall offen genug (auth_user_id = auth.uid()).
-- ------------------------------------------------------------
drop policy if exists "Public insert idle player state" on public.idle_player_state;
drop policy if exists "Owner insert idle player state" on public.idle_player_state;
create policy "Owner insert idle player state"
on public.idle_player_state for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Public update idle player state" on public.idle_player_state;
drop policy if exists "Owner update idle player state" on public.idle_player_state;
create policy "Owner update idle player state"
on public.idle_player_state for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

-- ------------------------------------------------------------
-- 3) Gleiche Absicherung fuer player_stats (Bonk-Zaehler, Titel,
--    Kosmetik-Auswahl) - selbes Muster, selbe Unsicherheit ueber den
--    tatsaechlich live aktiven Stand.
-- ------------------------------------------------------------
drop policy if exists "Public insert player stats" on public.player_stats;
drop policy if exists "Owner insert player stats" on public.player_stats;
create policy "Owner insert player stats"
on public.player_stats for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Public update player stats" on public.player_stats;
drop policy if exists "Owner update player stats" on public.player_stats;
create policy "Owner update player stats"
on public.player_stats for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

-- ------------------------------------------------------------
-- Hinweis: idle_dungeon_results (Bestenliste) hat laut Kommentar in
-- supabase-idle-dungeon-leaderboard.sql BEWUSST dasselbe offene Muster
-- ("dieses Projekt vertraut dem Client fuer Spielstand-Schreibzugriffe
-- bereits durchgehend") - das ist eine dokumentierte Design-Entscheidung
-- (nur Bestenlisten-Werte, kein Echtgeld), deshalb hier NICHT angefasst.
-- ------------------------------------------------------------
