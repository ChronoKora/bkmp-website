-- ============================================================
-- Drachendorf-Ausbau Phase 11 (04.10.2026): kleine Wochenereignisse
--
-- Sechs kleine Events auf demselben Framework wie das Zwielicht
-- (special_events), aber OHNE Pass/Stufen/Drachenbelohnung - nur ein
-- zeitlich begrenzter Bonus (config.modifiers). Alle sind AUS
-- (enabled = false, keine Termine) und fuer Spieler unsichtbar.
--
-- Einschalten fuer eine Woche (Montag 00:00 bis Sonntag 23:59 Berlin,
-- ohne Vorankuendigung):
--   select public.special_event_schedule('brutwoche', '2026-11-02', 0);
-- Andere Zeitraeume: direkt setzen, z.B.
--   update public.special_events set enabled = true, archived = false,
--     announce_at = '2026-11-06 00:00 Europe/Berlin', starts_at = '2026-11-06 00:00 Europe/Berlin',
--     ends_at = '2026-11-08 23:59 Europe/Berlin' where id = 'bossjagd';
-- Ausschalten: update public.special_events set enabled = false where id = 'brutwoche';
--
-- Wo die Boni wirken:
--   brood_speed_pct, dragon_growth_pct, harvest_pct, boss_reward_pct,
--   rune_fail_reduction_pct -> im Spiel (Anzeige + Berechnung im Browser,
--     wie die bestehenden Prestige-/Gilden-Boni derselben Werte)
--   expedition_reward_pct   -> serverseitig in expedition_start()
--   guild_project_points_pct -> serverseitig in guild_project_contribute()
--   (beide ueber bkmp_event_modifier(), 20261004-01)
-- Alle Boni sind auf hoechstens 100 % gedeckelt; laufen mehrere Events
-- gleichzeitig, addieren sie sich (ebenfalls hoechstens 100 %).
--
-- Voraussetzung: 20261004-06-special-events.sql. NOCH NICHT AUSGEFUEHRT.
-- Erneutes Ausfuehren aktualisiert nur Texte/Boni, nie Termine/Schalter.
-- ============================================================

insert into public.special_events (id, name, subtitle, description, timezone, enabled, archived,
  tier_count, points_per_tier, config, reward_group, lifetime_claim_limit, choice_mode, reward_species)
values
  ('brutwoche', 'Brutwoche', 'Die Nester sind warm',
   'Eine Woche lang schlüpfen Eier schneller und Babydrachen wachsen beim Füttern stärker.',
   'Europe/Berlin', false, false, 1, 1,
   '{"kind": "modifier", "icon": "🥚", "short": "Brutzeit −25 %, +25 % Wachstum beim Füttern", "modifiers": {"brood_speed_pct": 25, "dragon_growth_pct": 25}}'::jsonb,
   null, 0, 'none', '{}'::text[]),
  ('runenmond', 'Runenmond', 'Der Mond segnet die Schmiede',
   'Solange der Runenmond scheint, schlagen Runen-Aufwertungen nur halb so oft fehl.',
   'Europe/Berlin', false, false, 1, 1,
   '{"kind": "modifier", "icon": "🌕", "short": "Runen-Fehlschläge −50 %", "modifiers": {"rune_fail_reduction_pct": 50}}'::jsonb,
   null, 0, 'none', '{}'::text[]),
  ('bossjagd', 'Bossjagd', 'Kopfgeld auf die Großen',
   'Bosse und Minibosse bringen während der Bossjagd deutlich mehr Gold und Erfahrung.',
   'Europe/Berlin', false, false, 1, 1,
   '{"kind": "modifier", "icon": "👑", "short": "+50 % Gold und EP von Bossen", "modifiers": {"boss_reward_pct": 50}}'::jsonb,
   null, 0, 'none', '{}'::text[]),
  ('erntefest', 'Erntefest', 'Die Speicher füllen sich',
   'Obstgarten und Jagdhütte produzieren während des Erntefests deutlich mehr.',
   'Europe/Berlin', false, false, 1, 1,
   '{"kind": "modifier", "icon": "🌾", "short": "+50 % Früchte und Fleisch", "modifiers": {"harvest_pct": 50}}'::jsonb,
   null, 0, 'none', '{}'::text[]),
  ('expeditionsfieber', 'Expeditionsfieber', 'Alle wollen hinaus',
   'Expeditionen, die während des Fiebers gestartet werden, bringen mehr Beute mit.',
   'Europe/Berlin', false, false, 1, 1,
   '{"kind": "modifier", "icon": "🧭", "short": "+25 % Expeditionsbeute", "modifiers": {"expedition_reward_pct": 25}}'::jsonb,
   null, 0, 'none', '{}'::text[]),
  ('gildenwoche', 'Gildenwoche', 'Gemeinsam bauen',
   'Während der Gildenwoche zählt jede Einzahlung ins Gildenprojekt deutlich mehr.',
   'Europe/Berlin', false, false, 1, 1,
   '{"kind": "modifier", "icon": "🛡️", "short": "+50 % Gildenprojekt-Punkte", "modifiers": {"guild_project_points_pct": 50}}'::jsonb,
   null, 0, 'none', '{}'::text[])
on conflict (id) do update set
  name = excluded.name, subtitle = excluded.subtitle, description = excluded.description,
  config = excluded.config, tier_count = excluded.tier_count, points_per_tier = excluded.points_per_tier,
  lifetime_claim_limit = excluded.lifetime_claim_limit, choice_mode = excluded.choice_mode;

notify pgrst, 'reload schema';
