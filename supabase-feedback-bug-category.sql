-- Bkmp - Neue Feedback-Kategorie "Bug" (eigener Button statt nur "Kritik").
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Auf Spieler-Wunsch (Feedback von "SpielKein MC HoleNurErfolge"): ein
-- separater Button fuer Bugs/Glitches statt sie unter "Kritik" einsortieren
-- zu muessen. Erweitert nur den erlaubten Wertebereich der bestehenden
-- category-Spalte, keine neue Tabelle/Spalte noetig.

alter table public.feedback
  drop constraint if exists feedback_category_check;
alter table public.feedback
  add constraint feedback_category_check check (category in ('lob', 'idee', 'kritik', 'bug', 'sonstiges'));
