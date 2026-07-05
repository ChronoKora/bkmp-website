-- Bkmp - Anonyme Investoren + Minecraft-Name bei Anfragen
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Ergaenzt bestehende Tabellen um:
-- 1) public.investors.anonymous - Investor erscheint auf der Website als
--    "Anonym" statt mit echtem Namen/Minecraft-Kopf. Im Admin-Panel ist
--    der echte Name weiterhin immer sichtbar.
-- 2) public.investor_requests.minecraft_name / .anonymous - dieselbe Wahl
--    schon bei der Anfrage.
--
-- Sicher mehrfach ausfuehrbar (add column if not exists).

alter table public.investors
  add column if not exists anonymous boolean not null default false;

alter table public.investor_requests
  add column if not exists minecraft_name text;

alter table public.investor_requests
  add column if not exists anonymous boolean not null default false;
