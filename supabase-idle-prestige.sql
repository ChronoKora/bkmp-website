-- Bkmp - Idle Drachen Dorf: Prestige-System + 10 neue Skilltree-Kapitel
-- (Tiefe fuer alle 5 Zweige) + Aktivierung aller bisher wirkungslosen
-- Skilltree-Effekte.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG (Lehre aus dem letzten Vorfall mit last_skilltree_reset_at):
-- Die neue Prestige-Tabelle ist bewusst eine EIGENE Tabelle statt neuer
-- Spalten auf idle_player_state - dadurch kann ein noch nicht ausgefuehrtes
-- Migrieren dieser Datei niemals den normalen Spielstand (Gold/Level/Skills)
-- blockieren. supabase.js laedt/speichert Prestige-Daten ueber eine
-- vollstaendig separate Abfrage mit eigenem try/catch.

-- ============================================================
-- 1) idle_prestige_state - dauerhafter Fortschritt, wird NIE durch einen
--    normalen Prestige-Vorgang zurueckgesetzt (nur das ist ja der Sinn).
-- ============================================================
create table if not exists public.idle_prestige_state (
  name_key text primary key,
  display_name text not null,
  prestige_level integer not null default 0,
  prestige_points bigint not null default 0,
  prestige_points_spent bigint not null default 0,
  prestige_allocations jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.idle_prestige_state enable row level security;
grant select, insert, update on public.idle_prestige_state to anon, authenticated;
grant delete on public.idle_prestige_state to authenticated;

drop policy if exists "Public read idle prestige state" on public.idle_prestige_state;
create policy "Public read idle prestige state" on public.idle_prestige_state for select to anon, authenticated using (true);

drop policy if exists "Public insert idle prestige state" on public.idle_prestige_state;
create policy "Public insert idle prestige state" on public.idle_prestige_state for insert to anon, authenticated with check (true);

drop policy if exists "Public update idle prestige state" on public.idle_prestige_state;
create policy "Public update idle prestige state" on public.idle_prestige_state for update to anon, authenticated using (true) with check (true);

drop policy if exists "Admin delete idle prestige state" on public.idle_prestige_state;
create policy "Admin delete idle prestige state" on public.idle_prestige_state for delete to authenticated using (public.is_active_admin());

create index if not exists idle_prestige_state_level_idx on public.idle_prestige_state (prestige_level desc);

-- ============================================================
-- 2) 10 neue Skilltree-Kapitel (2 pro Zweig), bauen auf dem jeweils
--    letzten bestehenden Knoten auf. Alle effect_types sind ab sofort
--    echt verdrahtet (siehe idledorf.js) - nichts hiervon ist Zierde.
-- ============================================================
insert into public.idle_skill_nodes (id, branch, name, description, icon, sort_order, max_rank, cost_per_rank, requires_node_id, requires_rank, effect_type, effect_value_per_rank) values
  ('dorf_meisterschuetzen', 'dorf', 'Meisterschützen', 'Elite-Bogenschützen mit deutlich mehr Durchschlagskraft.', '🏆', 6, 5, 3, 'dorf_ballisten', 2, 'attack_pct', 4),
  ('dorf_kriegshorn',       'dorf', 'Kriegshorn',       'Koordiniert das Dorf zu noch schnelleren Salven.', '📯', 7, 4, 3, 'dorf_ballisten', 2, 'attack_speed_pct', 5),
  ('burg_bollwerk',         'burg', 'Bollwerk',         'Die Stadtmauern werden zu einem uneinnehmbaren Bollwerk.', '🏯', 6, 5, 3, 'burg_wachen', 3, 'hp_pct', 6),
  ('burg_eisentor',         'burg', 'Eisentor',         'Ein verstärktes Haupttor haelt selbst schwersten Angriffen stand.', '⛩️', 7, 5, 3, 'burg_wachen', 3, 'defense_pct', 5),
  ('wirt_schatzkammer',     'wirtschaft', 'Schatzkammer', 'Eine gut gesicherte Kammer vermehrt jeden gefundenen Gold-Taler.', '🏦', 6, 5, 3, 'wirt_lager', 3, 'gold_prod_pct', 5),
  ('wirt_expedition',       'wirtschaft', 'Expeditionscorps', 'Erfahrene Truppen sammeln auch in deiner Abwesenheit effizient.', '🧭', 7, 4, 3, 'wirt_lager', 3, 'offline_income_pct', 5),
  ('forsch_meisterschmied', 'forschung', 'Meisterschmied', 'Perfektionierte Waffenschmiedekunst durch jahrelange Forschung.', '🔨', 6, 5, 3, 'forsch_kartografie', 2, 'attack_pct', 4),
  ('forsch_archive',        'forschung', 'Große Archive', 'Jahrhunderte an Wissen beschleunigen jeden Lernfortschritt.', '📚', 7, 5, 3, 'forsch_kartografie', 2, 'xp_pct', 5),
  ('magie_erzmagier',       'magie', 'Erzmagier',        'Meisterschaft über Blitzmagie auf höchstem Niveau.', '🧙', 6, 4, 4, 'magie_meister', 2, 'elem_lightning', 3),
  ('magie_portal',          'magie', 'Dimensionsportal',  'Reißt kurzzeitig ein Portal auf, das Angriffe verstärkt zurückwirft.', '🌀', 7, 3, 4, 'magie_meister', 2, 'crit_damage_pct', 8),
  ('dorf_klickkraft',       'dorf', 'Klickkraft', 'Deine manuellen Treffer (Klicks auf Drache/Weltboss) verursachen zusätzlichen Schaden, oben auf die Basis von 12% des Angriffs.', '👆', 8, 8, 2, 'dorf_pfeilschaden', 2, 'click_damage_pct', 4)
on conflict (id) do nothing;
