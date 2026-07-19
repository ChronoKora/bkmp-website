/* ============================================================
   Fix fuer supabase-guild-quests.sql: guild_quest_ensure_today()
   warf live "column reference \"quest_type\" is ambiguous" (Postgres
   42702) und lieferte dadurch nie Quests aus - im Client sah das wie ein
   endloses "⏳ Lade Quests..." aus (Spieler-Report per Screenshot, 15.07.).

   Ursache: "returns table (..., quest_type text, ...)" fuehrt quest_type
   zusaetzlich als PL/pgSQL-Variable im GESAMTEN Funktionsrumpf ein. Das
   explizite Spalten-Ziel "on conflict (guild_id, quest_date, quest_type)"
   kollidierte damit. Fix: kein Spalten-Ziel mehr angeben - die Tabelle hat
   ohnehin nur einen einzigen Unique-Constraint, "on conflict do nothing"
   findet ihn automatisch, ganz ohne die Namenskollision.

   Live per RPC-Aufruf bestaetigt (test123-Account, Gilde als Anfuehrer):
   vorher {"code":"42702","message":"column reference \"quest_type\" is
   ambiguous"}, siehe supabase-guild-quests.sql fuer die aktualisierte
   Referenzversion.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (create or replace function).
   ============================================================ */

create or replace function public.guild_quest_ensure_today()
returns table (id uuid, quest_type text, target bigint, progress bigint, tier int, completed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_count int;
  v_types text[] := array['dragon_kills', 'gold_earned', 'arena_wins', 'prestige_ups'];
  v_chosen text[];
  v_tier int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  select count(*) into v_count from public.guild_daily_quests where guild_id = v_guild_id and quest_date = v_today;
  if v_count = 0 then
    v_chosen := array(select unnest(v_types) order by random() limit 3);
    for v_tier in 1..3 loop
      insert into public.guild_daily_quests (guild_id, quest_date, quest_type, target, tier)
      values (
        v_guild_id, v_today, v_chosen[v_tier],
        case v_chosen[v_tier]
          when 'dragon_kills' then 300 + floor(random() * 500)::bigint
          when 'gold_earned' then 1000000 + floor(random() * 4000000)::bigint
          when 'arena_wins' then 50 + floor(random() * 100)::bigint
          when 'prestige_ups' then 5 + floor(random() * 15)::bigint
        end,
        v_tier
      )
      on conflict do nothing;
    end loop;
  end if;

  return query
    select gdq.id, gdq.quest_type, gdq.target, gdq.progress, gdq.tier, gdq.completed
    from public.guild_daily_quests gdq
    where gdq.guild_id = v_guild_id and gdq.quest_date = v_today
    order by gdq.tier;
end;
$$;
grant execute on function public.guild_quest_ensure_today() to authenticated;
