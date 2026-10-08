-- Bkmp - Oeffentlicher Changelog-Eintrag: Zwielicht-Pass, Surebrec-Ei (Stufe 20).
-- Fertig ausgefuellt, idempotent (mehrfaches Ausfuehren unschaedlich).
-- ERST ausfuehren, NACHDEM sql/20261008-zwielicht-pass-fix-all.sql gelaufen ist und
-- dort jetzt_vergibt_abholen_eier = true zeigt.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-08', 'fix',
  'Zwielicht-Pass: Surebrec-Ei aus Stufe 20 nachgeliefert',
  'Beim Abholen von Stufe 20 kam das garantierte 🥚 Surebrec-Ei nicht an (bei einem Spieler auch das 🥚 Dayman-Ei aus Stufe 10). Das ist behoben: Abholen legt das Ei jetzt wieder ins Drachenlager, und alle fehlenden Eier wurden nachträglich gutgeschrieben – auch wenn du schon einen Surebrec aus dem Ei-Dungeon hattest. Bitte die Seite neu laden und im Drachenlager nachsehen. Fehlt trotzdem etwas, melde dich über das Feedback.'
where not exists (
  select 1 from public.changelog_entries
   where entry_date = '2026-10-08' and title = 'Zwielicht-Pass: Surebrec-Ei aus Stufe 20 nachgeliefert'
);
