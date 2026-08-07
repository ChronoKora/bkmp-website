-- Bkmp - Oeffentliche Changelog-Eintraege: die 5 spielerrelevanten Themen
-- dieser Sitzung, die bisher noch KEINEN oeffentlichen Changelog-Eintrag
-- hatten (Mobile-Redesign + die 4 begleitenden Fixes vom selben Tag sind
-- bereits in sql/20260806-changelog-mobile-redesign.sql erfasst). Gleiches
-- idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-Dateien -
-- bereits fertig ausgefuellt, kein Platzhalter, einfach im Supabase SQL
-- Editor ausfuehren.
--
-- Reihenfolge/Themen:
--   1) HUD-Icons oben rechts ueberlappten sich auf sehr breiten Monitoren.
--   2) Performance-Audit (Kampffenster ruckelte bei aktivem Auto-Kauf).
--   3) Kraftrune-Lager war auf sehr breiten Monitoren unerreichbar.
--   4) Drachenlager-Plaetze zwischen Geraeten nicht synchron.
--   5) Runen-Ansicht am PC neu aufgeraeumt (Lager jetzt im Hauptbereich
--      statt als schmaler schwebender Balken - baut auf Punkt 3 auf).
--
-- Hinweis Punkt 4: der zugehoerige eigentliche Fix braucht zusaetzlich
-- sql/20260806-dragon-storage-expansions-sync.sql (separate Datei, fuegt
-- die noetige Spalte hinzu) - falls die noch nicht gelaufen ist, bitte
-- VORHER ausfuehren, sonst beschreibt dieser Changelog-Eintrag eine Wirkung,
-- die serverseitig noch nicht greift.

-- ============================================================
-- 1) HUD-Icons (Effekte/Feedback/Schliessen) ueberlappten sich auf sehr
--    breiten Monitoren (2560px+).
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'fix',
  'Icons oben rechts im Idle-Dorf-Fenster überlappten sich auf breiten Monitoren',
  'Auf sehr breiten Bildschirmen (ab ca. 2560px) lagen die Icons für Effektmodus, Feedback und Schließen oben rechts im Idle-Dorf-Fenster zu dicht beieinander und überlappten sich teilweise. Jetzt haben sie auf jeder Bildschirmbreite genug Abstand zueinander.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Icons oben rechts im Idle-Dorf-Fenster überlappten sich auf breiten Monitoren'
);

-- ============================================================
-- 2) Performance-Audit: Kampffenster ruckelte bei aktivem Auto-Kauf, auch
--    mit ausgeschaltetem Effektmodus.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'fix',
  'Kampffenster spürbar flüssiger',
  'Das Idle-Dorf-Kampffenster konnte bei aktivem Auto-Kauf spürbar ruckeln, selbst mit ausgeschaltetem Effektmodus - jeder einzelne automatische Kauf hat bisher das komplette Menü und die Kopfzeile neu aufgebaut, bei starkem Auto-Kauf teils mehrfach pro Sekunde. Läuft jetzt deutlich sparsamer, ohne dass sich am Spielverhalten selbst etwas geändert hat (gleiche Käufe, gleiche Werte, gleiche Geschwindigkeit).'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Kampffenster spürbar flüssiger'
);

-- ============================================================
-- 3) Kraftrune-Lager war auf sehr breiten Monitoren unerreichbar.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'fix',
  'Kraftrune-Lager auf breiten Monitoren nicht erreichbar',
  'Auf sehr großen Bildschirmen (z.B. 2560×1440) konnte das Kraftrune-Lager im Runen-Tab so weit nach unten rutschen, dass es aus dem sichtbaren Bereich verschwand und nicht mehr bedienbar war. Jetzt bleibt es zuverlässig sichtbar und nutzbar, egal wie groß der Bildschirm ist.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Kraftrune-Lager auf breiten Monitoren nicht erreichbar'
);

-- ============================================================
-- 4) Drachenlager-Plaetze zwischen Geraeten (Handy/PC) nicht synchron.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'fix',
  'Drachenlager-Plätze zwischen Geräten nicht synchron',
  'Gekaufte Drachenlager-Erweiterungen wurden bisher nur auf dem jeweils genutzten Gerät gespeichert statt mit dem Account - wer z.B. am Handy und am PC spielt, konnte dadurch auf jedem Gerät eine andere Anzahl an Lagerplätzen sehen. Die Anzahl der gekauften Erweiterungen ist jetzt ein echter, mit dem Account verknüpfter Fortschritt und gleicht sich automatisch auf allen Geräten an - bereits gekaufte Plätze gehen dabei auf keinem Gerät verloren.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Drachenlager-Plätze zwischen Geräten nicht synchron'
);

-- ============================================================
-- 5) Runen-Ansicht am PC neu aufgeraeumt (Lager-Redesign, baut auf Punkt 3
--    auf).
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'change',
  'Runen-Ansicht am PC neu aufgeräumt',
  'Der Runen-Tab hatte am PC viel ungenutzten Leerraum in der Mitte - das Kraftrune-Lager saß nur als schmaler, schwebender Balken am rechten Rand. Jetzt ist das Lager fest in den großen Hauptbereich eingebettet, wodurch deutlich mehr Runen auf einen Blick sichtbar sind und nichts mehr überlappen kann. Alle Funktionen (Aufwerten, Aufstieg, Verschmelzen, Verkaufen, die Schnellaktionen oben) sind unverändert vorhanden, nur die Anordnung ist übersichtlicher geworden. Auf Handy/Tablet bleibt die bisherige Ansicht unverändert.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Runen-Ansicht am PC neu aufgeräumt'
);
