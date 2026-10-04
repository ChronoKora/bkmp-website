-- Bkmp - Oeffentlicher Changelog-Eintrag: Skilltree-Komfort (MAX-Knopf,
-- Skilltree-Builds, Auto-Skilltree). Fertig ausgefuellt, idempotent
-- (mehrfaches Ausfuehren unschaedlich).
--
-- Erst NACH dem Deploy des Branches feature/drachendorf-ausbau ausfuehren.
-- Keine weitere SQL noetig: die Builds werden in der bereits vorhandenen
-- Tabelle idle_player_meta gespeichert.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'feature',
  'Idle-Dorf: Skilltree schneller aufbauen – MAX-Knopf, Builds und Auto-Skilltree',
  'Kein hundertfaches Klicken mehr nach jedem Prestige! Jeder Skill hat jetzt neben „+1“ einen MAX-Knopf, der so viele Ränge kauft, wie gerade möglich – für alle Spieler. Sobald du zum ersten Mal aufsteigen kannst, speicherst du bis zu 3 Skilltree-Builds (z. B. Standard, Farm, Boss) und baust sie nach einem Aufstieg mit einem Klick wieder auf. Ein Build gibt nur Punkte aus, die du wirklich hast – reichen sie noch nicht, wird ein Teil wiederhergestellt (z. B. 80 / 500) und der Rest später ergänzt. Neu im Prestige-Zweig Automation: 🧠 Meister der Pfade – damit verteilt der Auto-Skilltree neue Skillpunkte nach jedem Level-Aufstieg automatisch nach deinem aktiven Build.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Idle-Dorf: Skilltree schneller aufbauen – MAX-Knopf, Builds und Auto-Skilltree'
);
