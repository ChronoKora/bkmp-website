-- ============================================================
-- Erste echte Geld-Funktion der Seite: ein optionaler, kaeuflicher
-- "Drachenrahmen" um das komplette Idle-Dorf-Fenster (1,99 EUR, Stripe
-- Checkout). Alles andere auf der Seite bleibt reine Spielwaehrung wie
-- bisher - dieser eine Artikel ist bewusst die einzige Ausnahme.
--
-- Wiederverwendet den bestehenden Dorf-Skin-Katalog (idle_village_skins /
-- idle_player_village_skins), damit es nur EINEN Freischalt-Mechanismus
-- gibt, aber mit zwei Erweiterungen:
--   - unlock_type bekommt den neuen Wert 'real_money' + eine eigene
--     price_eur_cents-Spalte (Cent-Betrag, um Rundungsfehler bei
--     Kommazahlen zu vermeiden - 1,99 EUR = 199).
--   - apply_scope unterscheidet, WO ein Skin wirkt: 'village' (bisheriges
--     Verhalten, ersetzt die Dorf-Hintergrund-Szene) oder 'window_frame'
--     (neu: legt sich als Rahmen um das GESAMTE Idle-Dorf-Fenster). Ein
--     Fenster-Rahmen ist unabhaengig vom Dorf-Hintergrund waehlbar - beides
--     kann gleichzeitig aktiv sein, deshalb eine EIGENE Spalte
--     active_window_frame auf idle_player_state statt die bestehende
--     active_village_skin (Einzelauswahl) wiederzuverwenden.
--
-- Der eigentliche Kauf laeuft NIE direkt vom Client gegen diese Tabellen -
-- nur die Server-Funktionen (api/create-checkout-session.js +
-- api/stripe-webhook.js, SUPABASE_SERVICE_ROLE_KEY) duerfen
-- real_money_purchases/idle_player_village_skins fuer 'real_money'-Artikel
-- schreiben. Die eigentliche Freischaltung passiert AUSSCHLIESSLICH im
-- Webhook (server-zu-server, von Stripe signiert) - niemals aufgrund einer
-- Client-Meldung "ich habe bezahlt", da das sonst faelschbar waere.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent.
-- ============================================================

alter table public.idle_village_skins drop constraint if exists idle_village_skins_unlock_type_check;
alter table public.idle_village_skins add constraint idle_village_skins_unlock_type_check
  check (unlock_type in ('free', 'purchase', 'achievement', 'boss_drop', 'real_money'));

alter table public.idle_village_skins add column if not exists price_eur_cents integer not null default 0;

alter table public.idle_village_skins add column if not exists apply_scope text not null default 'village';
alter table public.idle_village_skins drop constraint if exists idle_village_skins_apply_scope_check;
alter table public.idle_village_skins add constraint idle_village_skins_apply_scope_check
  check (apply_scope in ('village', 'window_frame'));

alter table public.idle_player_state add column if not exists active_window_frame text;

-- ============================================================
-- real_money_purchases: Kauf-Historie + Idempotenz-Anker fuer den
-- Stripe-Webhook (Stripe kann ein Event mehrfach zustellen - "status
-- bereits 'paid'?" verhindert doppelte Gutschrift). Kein Client-Zugriff
-- zum Schreiben - nur Lesen der eigenen Kaeufe (z.B. fuer eine spaetere
-- "Meine Kaeufe"-Anzeige).
-- ============================================================
create table if not exists public.real_money_purchases (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text unique,
  name_key text not null,
  auth_user_id uuid not null,
  skin_id text not null references public.idle_village_skins(id),
  amount_eur_cents integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists real_money_purchases_auth_user_idx on public.real_money_purchases (auth_user_id);

alter table public.real_money_purchases enable row level security;
grant select on public.real_money_purchases to authenticated;
drop policy if exists "Own purchases readable" on public.real_money_purchases;
create policy "Own purchases readable" on public.real_money_purchases for select to authenticated
using (auth_user_id = auth.uid());
-- Kein insert/update/delete fuer anon/authenticated - nur der Service-Role-Key
-- (api/create-checkout-session.js, api/stripe-webhook.js) schreibt hier.

-- ============================================================
-- Katalog-Eintrag: Drachenrahmen. image_file zeigt auf die noch
-- ausstehende echte Asset-Datei - Pfad final, sobald das Bild im Repo
-- liegt (siehe assets/frames/).
-- ============================================================
insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_eur_cents, apply_scope, sort_order)
values (
  'drachenrahmen',
  'Drachenrahmen',
  'Ein prunkvoller Rahmen mit zwei Wachdrachen, Kristallen und Fackeln um das gesamte Idle-Dorf-Fenster. Einmaliger Kauf, danach dauerhaft freigeschaltet.',
  '🐲',
  'assets/frames/drachenrahmen.png',
  '',
  'real_money',
  199,
  'window_frame',
  999
)
on conflict (id) do update set
  price_eur_cents = excluded.price_eur_cents,
  apply_scope = excluded.apply_scope,
  unlock_type = excluded.unlock_type;
