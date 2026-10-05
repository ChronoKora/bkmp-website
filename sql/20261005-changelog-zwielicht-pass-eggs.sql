-- Bkmp - Oeffentlicher Changelog-Eintrag: Zwielicht-Pass, fehlende garantierte Eier.
-- Fertig ausgefuellt, idempotent (mehrfaches Ausfuehren unschaedlich).
-- ERST ausfuehren, NACHDEM sql/20261005-zwielicht-pass-egg-catchup.sql gelaufen ist
-- (sonst verspricht der Eintrag etwas, das noch nicht gutgeschrieben wurde).

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'fix',
  'Zwielicht-Pass: fehlende Dracheneier werden nachgeliefert',
  'Bei manchen Spielern kam das garantierte Ei der Pass-Stufen nicht an: Stufe 10 (🥚 Dayman) und Stufe 20 (🥚 Surebrec). Die Stufe galt als abgeholt, das Ei fehlte aber im Lager. Das ist behoben – die fehlenden Eier wurden nachträglich gutgeschrieben (höchstens eins pro Stufe, wer sein Ei schon hatte, bekommt kein zweites). Bitte kurz im Drachenlager nachsehen. Fehlt bei dir trotzdem etwas, melde dich über das Feedback.'
where not exists (
  select 1 from public.changelog_entries
   where entry_date = '2026-10-05' and title = 'Zwielicht-Pass: fehlende Dracheneier werden nachgeliefert'
);
