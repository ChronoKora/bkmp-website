-- Gilden-Technologie: Drachenzucht-Zweig bekommt eine eigene Kategorie
-- (01.08.2026, Nutzerwunsch nach Live-Screenshot: die vier Zucht-Knoten
-- standen bisher unter "Schlacht" direkt neben den unabhaengigen
-- Kampfwert-Knoten (Angriff/Verteidigung/Kritchance/Turm-Vorreiter/...) -
-- "Können wir das mit Drachenzucht in einen Neuen Zweig gepackt?").
--
-- guild_tech_nodes.category hat bisher eine CHECK-Bedingung fuer nur zwei
-- Werte ('wachstum'/'schlacht'), siehe sql/20260731-guild-tech-tree-v2-
-- foundation.sql Abschnitt 1. Die 4 Drachenzucht-Knoten (bereits live seit
-- sql/20260801-guild-tech-drachenzucht-branch.sql) wandern in eine dritte,
-- neue Kategorie "drachenzucht" - rein kosmetische Umsortierung in eine
-- eigene Baum-Ansicht, keine Aenderung an Kosten/Effekten/Vorbedingungen.
-- Alle vier Vorbedingungen bleiben INNERHALB der neuen Kategorie (Zucht-
-- meisterschaft braucht nur die drei anderen Zucht-Knoten), dadurch bleibt
-- der Baum in sich geschlossen und rendert korrekt in der eigenen Ansicht.

begin;

alter table public.guild_tech_nodes drop constraint if exists guild_tech_nodes_category_check;
alter table public.guild_tech_nodes add constraint guild_tech_nodes_category_check
  check (category in ('wachstum', 'schlacht', 'drachenzucht'));

update public.guild_tech_nodes set category = 'drachenzucht'
where id in ('guild_zucht_kraft', 'guild_zucht_panzer', 'guild_zucht_vitalitaet', 'guild_zucht_meisterschaft');

commit;

-- POSTCHECK (manuell, im SQL Editor, nach dem Ausfuehren):
-- select id, category from public.guild_tech_nodes where id like 'guild_zucht_%' order by id;
--   -> alle vier Zeilen muessen category='drachenzucht' zeigen.
