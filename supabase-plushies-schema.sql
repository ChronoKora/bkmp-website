-- Bkmp - Pluschie-System (Kosmetik-Kategorie mit Code-Freischaltung)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG: Dieses Skript braucht die Funktion public.is_active_admin(),
-- die von supabase-security-hardening.sql angelegt wird.
--
-- Architektur-Hinweis: Es gibt auf dieser Seite kein echtes Nutzerkonto
-- (kein Passwort-Login fuer normale Besucher) - Spieler werden ueberall
-- (Achievements, Leaderboard, Bonk-Zaehler) ueber ihren selbst eingetragenen
-- Minecraft-Namen identifiziert (name_key = Name in Kleinbuchstaben, siehe
-- player_stats-Tabelle). Die Pluschie-Tabellen folgen demselben Muster statt
-- eines "user_id", damit es konsistent zum Rest der Seite bleibt.
--
-- Die Pluschie-DEFINITIONEN (Name/Bild/Beschreibung) leben als einfaches
-- JS-Array im Code (BKMP_PLUSHIES in app.js) - genau wie Kosmetiken und
-- Titel auch schon als Code-Konstanten existieren, nicht als DB-Tabelle.
-- In der Datenbank liegt nur das, was wirklich "Zustand" ist: Codes und
-- wer welchen Pluschie bereits freigeschaltet hat.

-- 1) Codes: von Admins erstellt, jeweils fuer genau einen Pluschie.
create table if not exists public.plushie_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plushie_id text not null,
  note text not null default '',
  is_redeemed boolean not null default false,
  redeemed_by_name_key text,
  redeemed_by_display_name text,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by_admin text
);

create index if not exists plushie_codes_plushie_idx on public.plushie_codes (plushie_id);
create index if not exists plushie_codes_redeemed_idx on public.plushie_codes (is_redeemed);

alter table public.plushie_codes enable row level security;

-- Nur Admins duerfen Codes ueberhaupt sehen oder anlegen (sonst koennte
-- jeder unbenutzte Codes im Klartext auslesen). Das Einloesen selbst laeuft
-- NICHT ueber den Browser-Client, sondern ueber eine Server-Funktion
-- (api/redeem-plushie-code.js) mit dem Service-Role-Key - so kann niemand
-- sich per direktem API-Aufruf selbst einen Code als "eingeloest" markieren
-- oder sich einen Pluschie clientseitig faelschen.
drop policy if exists "Admins read plushie codes" on public.plushie_codes;
create policy "Admins read plushie codes"
on public.plushie_codes for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins insert plushie codes" on public.plushie_codes;
create policy "Admins insert plushie codes"
on public.plushie_codes for insert
to authenticated
with check (public.is_active_admin());

-- 2) Freigeschaltete Pluschies pro Spieler (name_key = Minecraft-Name in
-- Kleinbuchstaben, wie bei player_stats).
create table if not exists public.user_plushies (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  display_name text not null,
  plushie_id text not null,
  unlocked_at timestamptz not null default now(),
  unique (name_key, plushie_id)
);

create index if not exists user_plushies_name_idx on public.user_plushies (name_key);

alter table public.user_plushies enable row level security;

-- Lesen ist oeffentlich (jeder darf sehen, wer welchen Pluschie hat - noetig
-- fuer die eigene Pluschie-Auswahl und die Bestenliste). Schreiben geht
-- bewusst NICHT ueber anon/authenticated, sondern nur ueber die
-- Server-Funktion mit dem Service-Role-Key - sonst koennte sich jeder per
-- direktem INSERT selbst einen Pluschie freischalten, ganz ohne Code.
drop policy if exists "Public read user plushies" on public.user_plushies;
create policy "Public read user plushies"
on public.user_plushies for select
to anon, authenticated
using (true);

-- 3) Ausgewaehlter Pluschie: wie active_title/active_cosmetic einfach ein
-- weiteres Feld in der schon vorhandenen player_stats-Tabelle (kein
-- separates "user_profile" noetig).
alter table public.player_stats add column if not exists active_plushie text not null default '';
