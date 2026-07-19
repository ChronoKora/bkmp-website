-- Bkmp - Einmaliges Aufraeumen der Bestenliste (player_stats).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Entfernt Test-Eintraege aus Entwicklungs-/Debug-Sessions (TestSpieler,
-- TestSpieler2, FreshTest, FreshTest2) sowie einen verwaisten Doppel-
-- Eintrag fuer DerJannikHase ("derjannikhase_leaderboard_bonks" - hatte
-- 0 Minuten/0 Erfolge, nur einen kopierten Bonk-Count; der echte
-- Fortschritt steckt im Eintrag "derjannikhase" und bleibt erhalten).
--
-- Einmalig ausfuehren. Nicht rueckgaengig zu machen.

delete from public.player_stats
where name_key in ('testspieler', 'testspieler2', 'freshtest', 'freshtest2', 'derjannikhase_leaderboard_bonks');
