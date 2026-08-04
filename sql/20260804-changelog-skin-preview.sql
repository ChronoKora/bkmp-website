-- Bkmp - Oeffentlicher Changelog-Eintrag: Dorf-Skins-Shop bekommt eine
-- Vorschau-Kachel + vergroesserte Live-Ansicht (04.08.2026). Gleiches
-- idempotentes Muster wie sql/20260726-changelog.sql /
-- sql/20260803-changelog-schluesselmeister-removed.sql /
-- sql/20260804-changelog-combat-visual-polish.sql /
-- sql/20260804-changelog-raid-actionbar.sql /
-- sql/20260804-changelog-rune-cap-removed.sql. Bereits fertig ausgefuellt,
-- kein Platzhalter.
--
-- Reiner Client-Anzeige-Eintrag - keine Kampfmechanik/-werte geaendert,
-- daher unabhaengig von jeder anderen SQL-Migration sofort einsetzbar.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-04', 'feature',
  'Dorf-Skins: Vorschau vor dem Kauf',
  'Jede Karte im Dorf-Skins-Shop zeigt jetzt eine kleine Vorschau - auch bei Skins, die ihr noch nicht besitzt. Klickt (oder drückt Enter) auf die Vorschau, um sie in groß und live animiert anzusehen, bevor ihr euch entscheidet.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-04' and title = 'Dorf-Skins: Vorschau vor dem Kauf'
);
