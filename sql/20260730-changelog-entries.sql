-- Bkmp - Oeffentliche Changelog-Eintraege fuer die Feedback-Board-Runde vom
-- 30.07.2026 (4 umgesetzte Spieler-Ideen, siehe CLAUDE.md-Abschnitt
-- "Feedback-Board-Runde: 4 Spieler-Ideen umgesetzt"). Gleiches idempotentes
-- Muster wie sql/20260726-changelog.sql (Pruefung per Datum+Titel - erneutes
-- Ausfuehren erzeugt keine Duplikate). Bereits fertig ausgefuellt, kein
-- Platzhalter, kein weiterer Handgriff noetig ausser diese Datei einmal im
-- Supabase SQL Editor auszufuehren.
--
-- Hinweis: der vierte Eintrag (Clan-Bestenliste & Clan-Arena) beschreibt ein
-- Feature, dessen Arena-Teil zusaetzlich sql/20260730-guild-arena.sql
-- braucht (noch nicht ausgefuehrt) - die Bestenliste allein funktioniert
-- bereits ohne diese Migration. Falls der Eintrag erst sichtbar werden soll,
-- sobald auch die Arena live ist: einfach den letzten insert-Block unten
-- (mit "Clan-Bestenliste & Clan-Arena" im Titel) vorerst weglassen und
-- separat nachtragen.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-30', 'fix',
  'Einsetzen-Button bei Runen war teils vom Lager verdeckt',
  'Auf einigen Fensterbreiten hat sich das geöffnete Runen-Lager über den "Einsetzen"-Knopf gelegt - ihr musstet das Lager erst schließen, um eine Rune tatsächlich auszurüsten. Der Bereich weicht jetzt automatisch aus, der Knopf bleibt immer erreichbar.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-30' and title = 'Einsetzen-Button bei Runen war teils vom Lager verdeckt'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-30', 'feature',
  'Auto-Kauf kann jetzt einzelne Ressourcen ausschließen',
  'Neu im Upgrades-Bereich: ihr könnt bestimmte Ressourcen (z.B. Gold) vom automatischen Kauf ausnehmen, wenn ihr gerade gezielt darauf sparen wollt - alle anderen Ressourcen kauft Auto-Kauf wie gewohnt weiter automatisch.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-30' and title = 'Auto-Kauf kann jetzt einzelne Ressourcen ausschließen'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-30', 'feature',
  'Zweig-Priorität für "Automatische Verteilung" im Prestige-Baum',
  'Wer die Automatisierung "Automatische Verteilung" freigeschaltet hat, kann jetzt per Pfeil-Knöpfen festlegen, welcher Prestige-Zweig bevorzugt automatisch ausgebaut wird - praktisch bei einem Baum mit so vielen Knoten.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-30' and title = 'Zweig-Priorität für "Automatische Verteilung" im Prestige-Baum'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-30', 'feature',
  'Neuer Tab: Clan-Bestenliste & Clan-Arena',
  'Ein neuer Bereich "Clan" zeigt eine Bestenliste aller Gilden nach Erfahrung sowie die neue Clan-Arena: Anführer und Stellvertreter können damit die eigene Gilde gegen andere Gilden ins Rennen schicken (bis zu 3x pro Tag) - ein Sieg füllt die gemeinsame Gildenkasse.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-30' and title = 'Neuer Tab: Clan-Bestenliste & Clan-Arena'
);

-- ============================================================
-- Zwei weitere, spaeter am selben Tag fertiggestellte Eintraege
-- (sw.js-Robustheit + Prestige-Panel-Umbau) - gleiches idempotentes Muster.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-30', 'fix',
  'Seltener Ladefehler bei installierter App-Version behoben',
  'In seltenen Fällen konnte ein kurzer Netzwerk-Aussetzer (z.B. bei einem Neuladen mitten im Laden) bei der "Als App installieren"-Version zu einer unschönen Fehlermeldung führen, statt einfach normal weiterzumachen. Das ist jetzt behoben.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-30' and title = 'Seltener Ladefehler bei installierter App-Version behoben'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-30', 'change',
  'Prestige-Baum direkt sichtbar statt weit unten versteckt',
  'Der Baum zum Verteilen eurer Prestige-Punkte stand bisher ganz unten im Prestige-Bereich, hinter viel Erklärtext - ihr musstet erst weit scrollen. Jetzt seht ihr den Baum sofort; die Erklärungen (was beim Aufstieg zurückgesetzt wird / erhalten bleibt, nächster Durchlauf, Meilensteine) findet ihr eingeklappt direkt darunter zum Aufklappen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-30' and title = 'Prestige-Baum direkt sichtbar statt weit unten versteckt'
);

-- ============================================================
-- Ein weiterer, spaeter am selben Tag fertiggestellter Eintrag (neuer
-- Runen-Sammel-Button "Auf +15 maximieren") - gleiches idempotentes Muster.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-30', 'feature',
  'Neuer Button: Legendäre Runen in einem Rutsch auf +15 maximieren',
  'Im Runen-Lager gibt es jetzt einen "⚡ Auf +15 maximieren"-Knopf, der alle unausgerüsteten Legendären des aktuellen Rüstungsplatzes automatisch bis +15 aufwertet - gleiche Gold-Kosten und Fehlschlagchance wie beim manuellen Aufwerten, nur ohne dutzendfaches Klicken nach einer längeren AFK-Pause.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-30' and title = 'Neuer Button: Legendäre Runen in einem Rutsch auf +15 maximieren'
);
