-- Bkmp - Oeffentliches Changelog (26.07.2026, Nutzer-Wunsch: "ich will das
-- wir so eine Art Changelog haben, was bei jedem Fix/Update wenn wir dann
-- commiten dort steht als Eintrag") - eigenstaendig, getrennt vom
-- bestehenden Feedback-/Status-Board (sql/20260721-feedback-public-board.sql,
-- public.feedback_public). Das Feedback-Board beantwortet "was ist der
-- Stand zu einer SPIELER-Meldung" (bug/idea, Status-Workflow), das
-- Changelog beantwortet die andere Frage "was wurde zuletzt am Spiel/an der
-- Seite tatsaechlich geaendert" - reine, kurze Eintraege, chronologisch,
-- keine Verknuepfung zu einer privaten Einreichung noetig.
--
-- Architektur bewusst simpel gehalten (kein Status-Workflow, keine
-- Duplikat-Verknuepfung, kein Fortschrittsverlauf wie beim Feedback-Board -
-- ein Changelog-Eintrag ist per Definition bereits abgeschlossen, sobald er
-- veroeffentlicht wird): eine einzige Tabelle, oeffentlich lesbar,
-- admin-only beschreibbar (identisches RLS-Muster wie ueberall sonst im
-- Projekt, siehe is_active_admin()).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

create table if not exists public.changelog_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  category text not null default 'fix' check (category in ('fix', 'feature', 'change', 'balance')),
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists changelog_entries_date_idx on public.changelog_entries (entry_date desc, created_at desc);

alter table public.changelog_entries enable row level security;

grant select on public.changelog_entries to anon, authenticated;
grant insert, update, delete on public.changelog_entries to authenticated;

drop policy if exists "Public read changelog entries" on public.changelog_entries;
create policy "Public read changelog entries"
on public.changelog_entries for select to anon, authenticated using (true);

drop policy if exists "Admin insert changelog entries" on public.changelog_entries;
create policy "Admin insert changelog entries"
on public.changelog_entries for insert to authenticated
with check (public.is_active_admin());

drop policy if exists "Admin update changelog entries" on public.changelog_entries;
create policy "Admin update changelog entries"
on public.changelog_entries for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admin delete changelog entries" on public.changelog_entries;
create policy "Admin delete changelog entries"
on public.changelog_entries for delete to authenticated
using (public.is_active_admin());

-- ============================================================
-- Erste zwei echte Eintraege (Nutzerwunsch 26.07.2026: "sql Zeile zum
-- ausfuellen bitte... ich will das nicht mehr selber ausführen [im Admin-
-- Panel eintippen]") - bereits fertig ausgefuellt, kein Platzhalter, kein
-- weiterer Handgriff noetig ausser dieser Datei einmal auszufuehren.
-- Laeuft im selben Editor-Lauf wie die Tabelle oben (idempotent - bei
-- erneutem Ausfuehren dieser Datei entstehen KEINE Duplikate, da per
-- Titel+Datum geprueft wird).
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-26', 'fix',
  'Runen im Lager blieben nach einem Neustart manchmal unsichtbar',
  'Bei einem sehr großen Runen-Lager konnte das Laden beim Öffnen des Spiels an einem Netzwerk-Hänger scheitern und zeigte dann fälschlich ein leeres Inventar. Eure Runen waren dabei nie wirklich weg - das Laden ist jetzt zuverlässiger, und es gibt einen neuen "Alle [Seltenheit] verkaufen"-Knopf, um ein großes Lager schnell aufzuräumen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-26' and title = 'Runen im Lager blieben nach einem Neustart manchmal unsichtbar'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-26', 'change',
  'Minimieren-Knopf am Raidboss-Hinweis entfernt',
  'Der kleine Pfeil zum Minimieren des Raidboss-Banners brachte kaum etwas und wirkte eher störend - Timer und Anmeldestatus bleiben wie gewohnt sichtbar.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-26' and title = 'Minimieren-Knopf am Raidboss-Hinweis entfernt'
);

-- ============================================================
-- Zwei weitere, spaeter am selben Tag fertiggestellte Eintraege
-- (Hover-Ruckeln-Fix + Auto-Schmelzen-Fix) - ebenfalls bereits fertig
-- ausgefuellt, gleiches idempotentes Muster.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-26', 'fix',
  'Hover-Effekte reagierten verzögert und ruckelig',
  'Buttons, Karten und Tabs im gesamten Idle-Dorf reagierten beim Überfahren mit der Maus spürbar verzögert statt sofort hochzuploppen. Die Ursache war eine ineffiziente Animation in der Hauptnavigation - jetzt reagiert der Hover-Effekt direkt, ohne spürbare Wartezeit.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-26' and title = 'Hover-Effekte reagierten verzögert und ruckelig'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-26', 'fix',
  '"Auto-Schmelzen" erkannte Runen im Lager nicht',
  'Der "Auto-Schmelzen"-Knopf im Runen-Lager zeigte fälschlich "0" an, obwohl passende Runen vorhanden waren - "Lager aufräumen" fand dieselben Runen dabei problemlos. Beide Funktionen nutzen jetzt dieselbe, zuverlässige Quelle und finden garantiert denselben Bestand.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-26' and title = '"Auto-Schmelzen" erkannte Runen im Lager nicht'
);

-- ============================================================
-- Dringender Fix (26.07.2026, Spieler-Meldungen Danw_90 + Kaledoss):
-- Speichern schlug über Level 2000 dauerhaft fehl.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-26', 'fix',
  'Speichern schlug über Level 2000 dauerhaft fehl',
  'Ab Level 2001 konnte der Spielstand nicht mehr gespeichert werden - eine alte, viel zu niedrig angesetzte Sicherheitsgrenze in der Datenbank hat jeden Speicherversuch abgelehnt. Eure Daten waren dabei nie in Gefahr, der zuletzt erfolgreich gespeicherte Stand blieb erhalten - Speichern funktioniert jetzt auch weit über Level 2000 hinaus wieder normal.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-26' and title = 'Speichern schlug über Level 2000 dauerhaft fehl'
);

-- ============================================================
-- Direkte Nachbesserung am selben Tag: Buttons in Upgrades/Runen/Prestige/
-- Dorf-Skins/Drachenzucht reagierten während aktivem Kampf träge.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-26', 'fix',
  'Buttons in Upgrades, Runen & Co. reagierten während des Kampfes träge',
  'Während aktivem Kampf bauten sich die Bereiche Upgrades, Runen, Prestige, Dorf-Skins und Drachenzucht bei jedem besiegten Drachen komplett neu auf - stand die Maus dabei gerade über einem Knopf, fühlte sich das verzögert an. Diese Bereiche warten jetzt, bis ihr die Maus wegbewegt, bevor sie sich aktualisieren - Kampf lief davon unabhängig schon immer flüssig.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-26' and title = 'Buttons in Upgrades, Runen & Co. reagierten während des Kampfes träge'
);

-- ============================================================
-- Ebenfalls am selben Tag: OBS-Stream-Overlay blieb bei längerem
-- unfokussiertem Hauptfenster stehen.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-26', 'fix',
  'OBS-Stream-Overlay blieb bei unfokussiertem Hauptfenster stehen',
  'Wenn das Hauptspiel-Fenster längere Zeit im Hintergrund lief (z.B. während des Streamens), zeigte das OBS-Overlay keinen neuen Fortschritt mehr - nur die Deko-Animationen liefen weiter. Der Kampf läuft jetzt auch in diesem Fall regelmäßig für Zuschauer sichtbar weiter.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-26' and title = 'OBS-Stream-Overlay blieb bei unfokussiertem Hauptfenster stehen'
);
