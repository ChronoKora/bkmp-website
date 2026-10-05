-- Bkmp - Oeffentlicher Changelog-Eintrag: Drachen-Lexikon zeigt Formen erst, wenn man sie
-- erreicht hat (05.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. Erst NACH dem Deploy ausfuehren (die Aenderung muss live sein).
-- Kategorie 'change' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'change',
  'Drachen-Lexikon: Formen werden erst enthüllt, wenn du sie erreicht hast',
  'Bisher konntest du im Lexikon schon mit dem Ei alle späteren Formen eines Drachen sehen. Jetzt bleibt jede Form eine schwarze Silhouette, bis du sie wirklich erreicht hast – erst das Ei, dann Baby, Jugendlich und Erwachsen, sobald dein Drache aufsteigt. Auch das Vorschaubild im Lexikon zeigt nur noch die höchste Form, die du schon kennst. Einmal enthüllte Formen bleiben dauerhaft sichtbar, auch wenn du den Drachen später freilässt.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Drachen-Lexikon: Formen werden erst enthüllt, wenn du sie erreicht hast'
);
