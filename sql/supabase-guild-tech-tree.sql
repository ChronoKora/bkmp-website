/* ============================================================
   Gildensystem-Erweiterung, Phase E: Gilden-Technologie
   (Spieler-Wunsch: "Neue Registerkarte: Gilden-Technologie... 9
   Verbesserungen... kosten Gildenkasse... nur Anfuehrer oder
   Stellvertreter duerfen Punkte investieren... Boni gelten fuer
   saemtliche Mitglieder").

   Kostet die AUSGEBBARE Kasse (treasury_gold), NICHT guild_xp - Level
   und Technologie sind bewusst zwei getrennte Fortschritts-/Ausgaben-
   Systeme (siehe Kommentar in supabase-guild-extension-foundation.sql).
   Die 9 gueltigen tech_id-Werte + die Kostenkurve (200.000 * 1,4^Stufe)
   sind server- UND clientseitig hart hinterlegt - der Client rechnet
   nur zur Anzeige, die Kosten werden HIER nochmal serverseitig
   nachgerechnet (nie dem Client vertrauen, gleiches Prinzip wie ueberall
   sonst in diesem Projekt).

   Baut auf supabase-guild-extension-foundation.sql auf. Supabase
   Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent.
   ============================================================ */

create table if not exists public.guild_tech_levels (
  guild_id uuid not null references public.guilds(id) on delete cascade,
  tech_id text not null,
  level int not null default 0,
  primary key (guild_id, tech_id)
);
alter table public.guild_tech_levels enable row level security;
grant select on public.guild_tech_levels to anon, authenticated;
drop policy if exists "Public read guild tech" on public.guild_tech_levels;
create policy "Public read guild tech" on public.guild_tech_levels for select to anon, authenticated using (true);
-- Kein direktes insert/update fuer Clients - nur guild_tech_upgrade() unten.

create or replace function public.guild_tech_upgrade(p_tech_id text)
returns table (new_level int, treasury_gold bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_my_role text;
  v_display_name text;
  v_current_level int;
  v_cost bigint;
  v_treasury bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_tech_id not in ('attack', 'defense', 'gold', 'crit_chance', 'crit_damage', 'boss_damage', 'rune_luck', 'xp', 'prestige') then
    raise exception 'invalid_tech';
  end if;

  select guild_id, role, display_name into v_guild_id, v_my_role, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null or v_my_role not in ('leader', 'officer') then raise exception 'not_authorized'; end if;

  select coalesce(level, 0) into v_current_level from public.guild_tech_levels where guild_id = v_guild_id and tech_id = p_tech_id;
  v_current_level := coalesce(v_current_level, 0);
  if v_current_level >= 20 then raise exception 'max_level'; end if;

  v_cost := round(200000 * power(1.4, v_current_level));
  select guilds.treasury_gold into v_treasury from public.guilds where id = v_guild_id;
  if v_treasury is null or v_treasury < v_cost then raise exception 'insufficient_treasury'; end if;

  /* BUGFIX (Spieler-Report 15.07., Toast "column reference treasury_gold
     is ambiguous"): RETURNS TABLE(..., treasury_gold bigint) legt intern
     eine gleichnamige Ausgabevariable "treasury_gold" an, die mit der
     Tabellenspalte guilds.treasury_gold kollidiert - Postgres kann dann
     nicht mehr entscheiden, welche der beiden hier gemeint ist. Fix: alle
     Bezuege auf die Tabellenspalte explizit mit "guilds." qualifizieren. */
  update public.guilds set treasury_gold = guilds.treasury_gold - v_cost where id = v_guild_id returning guilds.treasury_gold into v_treasury;

  insert into public.guild_tech_levels (guild_id, tech_id, level) values (v_guild_id, p_tech_id, 1)
  on conflict (guild_id, tech_id) do update set level = guild_tech_levels.level + 1
  returning level into v_current_level;

  insert into public.guild_activity_log (guild_id, kind, actor_name, value, extra)
  values (v_guild_id, 'tech_upgrade', v_display_name, v_current_level, p_tech_id);

  return query select v_current_level, v_treasury;
end;
$$;
grant execute on function public.guild_tech_upgrade(text) to authenticated;
