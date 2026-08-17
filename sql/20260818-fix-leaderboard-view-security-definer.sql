-- Bkmp - Supabase Security Advisor CRITICAL-Fund beheben: "Security Definer
-- View" fuer public.idle_player_state_leaderboard (Screenshot 18.08.2026).
--
-- WAS DER ADVISOR MEINT: die View lief bisher OHNE security_invoker=true
-- (Postgres-Standard fuer Views = laeuft mit den Rechten des ERSTELLERS,
-- nicht des Aufrufers - Supabase nennt das "Security Definer View"). Das war
-- eine bewusste Entscheidung (siehe Kommentare in sql/20260809-leaderboard-
-- hide-mechanism.sql): die View muss idle_leaderboard_hidden_accounts lesen
-- koennen, obwohl anon dort explizit KEINE eigene Select-Policy hat (Admin-
-- only) - ohne diesen Bypass waere die Ausblend-Logik fuer jeden nicht
-- eingeloggten Betrachter wirkungslos gewesen (die NOT-EXISTS-Unterabfrage
-- haette fuer anon immer "true" ergeben, da RLS ihm ALLE Zeilen der
-- geschuetzten Tabelle unsichtbar macht).
--
-- TATSAECHLICHES RISIKO GEPRUEFT (nicht nur behauptet, per Lesen von
-- sql/supabase-idle-dorf-schema.sql bestaetigt): idle_player_state selbst
-- hat schon eine voll oeffentliche Select-Policy fuer ALLE Spalten
-- ("Public read idle player state", for select to anon, authenticated using
-- (true)) - die View gibt ohnehin nur eine Teilmenge dieser Spalten zurueck.
-- Der bisherige Bypass hat also KEINE zusaetzlichen Daten offengelegt, die
-- nicht schon direkt ueber die Basistabelle abrufbar waeren - kein akuter
-- Datenverlust, kein Grund zur Eile. ABER: der Advisor hat trotzdem recht,
-- dass das schlechte Praxis ist - sollte idle_player_state's RLS jemals
-- verschaerft werden (z.B. einzelne Spalten eingeschraenkt), wuerde diese
-- View die Verschaerfung stillschweigend ignorieren und weiter alles zeigen,
-- da sie mit den Rechten des Erstellers statt des Aufrufers laeuft.
--
-- FIX (sauberer als den Bypass einfach zu belassen): der noetige Rechte-
-- Bypass wird auf das MINIMUM verengt - eine einzelne, eng gefasste
-- SECURITY-DEFINER-FUNKTION (exakt dasselbe, bereits im ganzen Projekt
-- etablierte Muster wie is_active_admin(), siehe sql/supabase-security-
-- hardening.sql), die NUR einen booleschen "ist dieser Name versteckt?"-Wert
-- zurueckgibt, nie den Inhalt von idle_leaderboard_hidden_accounts selbst
-- (Grund/wer/wann bleiben weiterhin Admin-only). Die VIEW selbst bekommt
-- jetzt security_invoker=true - laeuft also mit den Rechten des Aufrufers,
-- respektiert damit automatisch jede kuenftige RLS-Aenderung an
-- idle_player_state, und wird vom Supabase-Advisor nicht mehr als "Security
-- Definer View" markiert (nur noch die enge Funktion traegt den Definer-
-- Status, exakt wie is_active_admin() das im gesamten Projekt schon tut).
--
-- WICHTIG: baut auf sql/20260811-leaderboard-hide-decouple-from-flags.sql
-- auf und ist die ab jetzt MASSGEBLICHE Fassung der View - falls die
-- aelteren Dateien 20260809/20260811 aus irgendeinem Grund jemals erneut
-- ausgefuehrt werden, wuerden sie diesen Fix wieder ueberschreiben (dann
-- einfach diese Datei danach erneut ausfuehren).
--
-- Kein Verhaltensunterschied fuer Spieler/Admin - die Bestenliste zeigt
-- exakt dieselben Zeilen wie vorher (unveraenderte Spaltenliste, unveraen-
-- derter "nur manuell versteckte Accounts fehlen"-Filter aus dem 11.08.-Fix),
-- nur die interne Absicherung ist jetzt enger gefasst. supabase.js/das
-- Admin-Panel brauchen keine Aenderung.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

create or replace function public.is_leaderboard_hidden(p_name_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.idle_leaderboard_hidden_accounts
    where name_key = p_name_key
  );
$$;

grant execute on function public.is_leaderboard_hidden(text) to anon, authenticated;

drop view if exists public.idle_player_state_leaderboard;

create view public.idle_player_state_leaderboard
with (security_invoker = true)
as
select s.name_key, s.display_name, s.level, s.total_gold_earned, s.dragon_kills,
       s.playtime_seconds, s.highest_dragon_index, s.prestige_stage_offset, s.turm_highest_wave
from public.idle_player_state s
where not public.is_leaderboard_hidden(s.name_key);

grant select on public.idle_player_state_leaderboard to anon, authenticated;
