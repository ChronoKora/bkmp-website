-- Bkmp - Oeffentlicher Changelog-Eintrag: Investoren-Anfrage ließ sich nicht absenden.
-- Fertig ausgefuellt, idempotent (mehrfaches Ausfuehren unschaedlich).
-- Erst ausfuehren, NACHDEM der Code-Fix (supabase.js) auf der Website live ist.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-06', 'fix',
  'Investoren-Anfrage lässt sich wieder absenden',
  'Das Formular für die Investoren-Anfrage hat beim Absenden mit „Deine Anfrage konnte nicht gesendet werden“ abgebrochen – deine Anfrage kam dadurch nicht bei uns an. Das ist behoben. Wenn du es in den letzten Wochen vergeblich versucht hast, schick die Anfrage bitte einfach noch einmal ab. Danke an alle, die uns darauf aufmerksam gemacht haben!'
where not exists (
  select 1 from public.changelog_entries
   where entry_date = '2026-10-06' and title = 'Investoren-Anfrage lässt sich wieder absenden'
);
