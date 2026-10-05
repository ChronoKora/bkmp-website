-- Bkmp - Oeffentliche Changelog-Eintraege (05.10.2026): "Alle Eier einer Art
-- freilassen" + Fix "Drachen blieben nach dem Erwachsenwerden still
-- ausgeruestet" (siehe CHANGELOG.md/CLAUDE.md fuer die technische Herleitung).
-- Gleiches idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-Dateien -
-- bereits fertig ausgefuellt, einfach im Supabase SQL Editor ausfuehren,
-- mehrfaches Ausfuehren ist unschaedlich.
-- Reihenfolge-Hinweis: erst NACH dem Deploy (bkmp-breeding.js/supabase.js
-- ?v=20261005-eggbulk1) und nach sql/20261005-dragon-graduate-unequip.sql
-- ausfuehren, damit der Text nicht vor dem tatsaechlichen Stand erscheint.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'feature',
  'Drachen-Eier: Alle Eier einer Art auf einmal freilassen',
  'Wer von einer Drachenart viele Eier gesammelt hat, muss sie nicht mehr einzeln löschen: Auf jeder Ei-Karte mit mindestens 2 freien Eiern gibt es jetzt unter „In freies Nest legen“ den Knopf „🗑️ Alle N freilassen“. Eier, die gerade in einem Nest brüten, bleiben immer erhalten, einzigartige Drachen (z. B. Lightnix/Darknix) lassen sich nicht freilassen, und bei epischen und legendären Eiern fragt das Spiel zur Sicherheit ein zweites Mal nach. Der kleine Mülleimer oben rechts löscht weiterhin genau ein Ei. Idee von ByAlex0 – danke!'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Drachen-Eier: Alle Eier einer Art auf einmal freilassen'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'fix',
  'Drachenzucht: Frisch erwachsene Drachen blieben unbemerkt „ausgerüstet“',
  'Wenn ein Drache vom Training zum Erwachsenen wurde, blieb er heimlich als Kampf-Begleiter markiert, obwohl er nirgends eingesetzt war: Er ließ sich nicht freilassen, passte in kein Expeditions-Team und sammelte unbemerkt Bindung. Jetzt wird die Markierung beim Erwachsenwerden entfernt – und bereits betroffene Drachen werden beim Öffnen des Drachenlagers automatisch bereinigt (Bindung und alles andere bleiben dabei erhalten). Bewusst ausgerüstete Kampf-Begleiter bleiben unverändert.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Drachenzucht: Frisch erwachsene Drachen blieben unbemerkt „ausgerüstet“'
);
