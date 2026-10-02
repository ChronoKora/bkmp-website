-- Bkmp - Oeffentliche Changelog-Eintraege: neue Erfolge "BK-Mod & Shops"
-- + neues Easter Egg (02.10.2026, siehe CHANGELOG.md fuer die technische
-- Herleitung). Gleiches idempotentes Muster wie alle bisherigen
-- sql/*-changelog-*.sql-Dateien - bereits fertig ausgefuellt, einfach im
-- Supabase SQL Editor ausfuehren, mehrfaches Ausfuehren ist unschaedlich.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-02', 'feature',
  'Neue Erfolge: BK-Mod & PartnerShops',
  'Neue Erfolgs-Kategorie „BK-Mod & Shops“: Verbinde die Mod mit deinem Konto („Verbunden“), reiche Karten direkt im Spiel über die Mod ein (Mod-Pionier bis Weltvermesser – zählt, sobald das Team die Karte annimmt) und trag deinen eigenen Shop als PartnerShop ein („Ladenbesitzer“). Dazu gibt es 7 neue Titel und 3 neue Namens-Effekte: ⚡ Redstone-Signal, 🗺️ Kartografen-Tinte und 🏪 Smaragd-Händler. Gesperrte Titel und Effekte zeigen außerdem jetzt an, welchen Erfolg du dafür brauchst.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-02' and title = 'Neue Erfolge: BK-Mod & PartnerShops'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-02', 'feature',
  'Ein neues Easter Egg ist aufgetaucht',
  'Irgendwo auf der Website reagiert jetzt etwas auf einen Befehl, den jeder Shop-Besucher kennt … Wer es findet, wird mit einem eigenen Titel und dem Namens-Effekt 🌀 Nether-Portal belohnt. Der Erfolg „Osterhase“ braucht dadurch jetzt 20 statt 19 Easter Eggs – wer ihn schon hat, behält ihn natürlich.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-02' and title = 'Ein neues Easter Egg ist aufgetaucht'
);
