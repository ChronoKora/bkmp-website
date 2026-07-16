/* ============================================================
   Produktionsgebäude (Spieler-Vorgabe 17.07. nachts): Upgrade-Menü um 6
   neue dauerhaft-produzierende Gebäude erweitert - Holzfällerlager,
   Steinbruch, Goldmine, Kristallmine, Manaquelle, Magierakademie. Gleiches
   Muster wie die bestehenden Obstgarten/Jagdhütte-Gebäude (siehe
   supabase-dragon-breeding.sql): eine integer-Level-Spalte + eine
   timestamptz-Checkpoint-Spalte pro Gebäude, Produktion wird clientseitig
   aus der seit dem letzten Checkpoint vergangenen Zeit berechnet (siehe
   bkmpIdleAccrueProductionBuildings in idledorf.js) - funktioniert dadurch
   automatisch auch offline, ganz ohne Server-Route.

   "Mana" ist eine komplett neue Ressource (gab es vorher nirgends im
   Spiel) - bewusst wie gold/wood/stone/crystals OHNE Lager-Deckel (im
   Gegensatz zu fruit/meat), da es (noch) keinen Verbrauchs-Sink dafuer
   gibt und die Mehrheit der bestehenden Ressourcen ebenfalls ungedeckelt
   ist.

   Idempotent: mehrfaches Ausfuehren ist unschaedlich (add column if not
   exists). Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren.
   ============================================================ */

alter table public.idle_player_state add column if not exists mana bigint not null default 0;

alter table public.idle_player_state add column if not exists holzfaeller_level integer not null default 0;
alter table public.idle_player_state add column if not exists holzfaeller_collected_at timestamptz not null default now();

alter table public.idle_player_state add column if not exists steinbruch_level integer not null default 0;
alter table public.idle_player_state add column if not exists steinbruch_collected_at timestamptz not null default now();

alter table public.idle_player_state add column if not exists goldmine_level integer not null default 0;
alter table public.idle_player_state add column if not exists goldmine_collected_at timestamptz not null default now();

alter table public.idle_player_state add column if not exists kristallmine_level integer not null default 0;
alter table public.idle_player_state add column if not exists kristallmine_collected_at timestamptz not null default now();

alter table public.idle_player_state add column if not exists manaquelle_level integer not null default 0;
alter table public.idle_player_state add column if not exists manaquelle_collected_at timestamptz not null default now();

alter table public.idle_player_state add column if not exists magierakademie_level integer not null default 0;
alter table public.idle_player_state add column if not exists magierakademie_collected_at timestamptz not null default now();

notify pgrst, 'reload schema';
