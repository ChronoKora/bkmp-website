-- Bkmp - Oeffentlicher Changelog-Eintrag: Kampf-Tab reagiert jetzt ebenso
-- schnell wie die anderen Tabs (03.10.2026, Teil 2 des Hover-Fixes, siehe
-- CHANGELOG.md/CLAUDE.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-03', 'fix',
  'Kampf-Tab reagiert jetzt genauso flüssig wie der Rest',
  'Im Kampf-Tab haben Knöpfe beim Drüberfahren mit der Maus noch leicht verzögert reagiert. Ursache waren die weichen Schatten unter Drache und Dorf: weil beide Videos sind, musste der Browser diese Schatten bei jedem einzelnen Bild neu berechnen – sogar mit „Effekte: Aus“. Die Schatten werden jetzt nur noch einmal gezeichnet und sehen genauso aus. Gilt auch für den Weltboss und den Gildenboss.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-03' and title = 'Kampf-Tab reagiert jetzt genauso flüssig wie der Rest'
);
