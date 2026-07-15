-- ============================================================
-- Live-Incident-Fix 15.07. (Supabase-Logs: Postgres-Fehlerrate von ~0 auf
-- ueber 5000/h hochgeschnellt, zwei Fehlerklassen aus guild_quest_contribute()):
--
-- 1) "22P02 invalid input syntax for type bigint: 78.6311" (und aehnliche
--    Dezimalwerte) - der bisherige direkte Cast "v_delta_text::bigint"
--    (siehe supabase-guild-quests.sql) akzeptiert KEINE Dezimalstellen,
--    im Gegensatz zu einem Cast ueber numeric mit anschliessendem round().
--    Selbst wenn aktuell alle bekannten Aufrufer im Client bereits
--    gerundete Ganzzahlen schicken (geprueft: gold_earned kommt aus
--    bkmpIdleRewardsAt(), das schon Math.round() nutzt) - ein einziger
--    zukuenftiger Aufrufer mit einem nicht gerundeten Wert reicht, um
--    diese Fehlerklasse erneut auszuloesen. Jetzt robust: Cast ueber
--    numeric + round() statt direktem bigint-Cast, exakt dasselbe Prinzip
--    wie bereits bei upsertIdlePlayerState() im Client (siehe
--    BKMP_IDLE_STATE_INTEGER_COLUMNS in supabase.js).
--
-- 2) "P0001 not_in_guild" - die Funktion wird automatisch bei JEDEM
--    4-Sekunden-Autosave gefeuert, sobald der Client ueberhaupt
--    ausstehende Deltas hat (siehe bkmpGuildQuestFlushDeltas in
--    idledorf.js). Der dortige Client-Guard (nur aufrufen, wenn
--    bkmpGuildState.guild bekannt ist) ist zwar korrekt, schuetzt aber
--    NICHT vor bereits laenger offenen Browser-Tabs mit altem, gecachtem
--    JS-Stand von vor diesem Guard (Idle-Games laufen typischerweise
--    stundenlang in einem Tab). "Kein Gilde" ist fuer diese rein
--    automatische Hintergrund-Funktion kein echter Fehlerfall, den der
--    Nutzer je zu sehen bekommt oder auf den reagieren koennte - jetzt
--    stiller No-Op statt Exception, analog zu anderen "erwarteten,
--    folgenlosen" Faellen in dieser Funktion (z.B. "kein passendes Quest
--    heute" wird schon jetzt per "continue" uebersprungen, nicht per
--    raise).
--
-- Ansonsten 1:1 identisch zu supabase-guild-quests.sql - nur die zwei
-- oben beschriebenen Zeilen geaendert (Zeile mit "raise exception
-- 'not_in_guild'" -> "return", Zeile mit "v_delta_text::bigint" -> Cast
-- ueber numeric+round). Supabase Dashboard > SQL Editor > New query >
-- diesen Inhalt ausfuehren. Idempotent (create or replace).
-- ============================================================

create or replace function public.guild_quest_contribute(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_key text;
  v_delta_text text;
  v_delta bigint;
  v_quest record;
  v_new_progress bigint;
  v_just_completed boolean;
  v_member record;
  v_rune_type text;
  v_rarity text;
  v_rolled numeric;
  v_i int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then return; end if;

  for v_key, v_delta_text in select key, value from jsonb_each_text(p_deltas) loop
    v_delta := round(nullif(v_delta_text, '')::numeric)::bigint;
    if v_delta is null or v_delta <= 0 then continue; end if;

    select * into v_quest from public.guild_daily_quests
    where guild_id = v_guild_id and quest_date = v_today and quest_type = v_key and not completed
    for update;
    if v_quest.id is null then continue; end if;

    v_new_progress := least(v_quest.target, v_quest.progress + v_delta);
    v_just_completed := v_new_progress >= v_quest.target;

    update public.guild_daily_quests
    set progress = v_new_progress, completed = v_just_completed
    where id = v_quest.id;

    if v_just_completed then
      insert into public.guild_activity_log (guild_id, kind, extra) values (v_guild_id, 'quest_completed', v_key);

      for v_member in select auth_user_id, name_key, display_name from public.guild_members where guild_id = v_guild_id loop
        update public.idle_player_state
        set gold = gold + (case v_quest.tier when 1 then 2000 when 2 then 6000 else 15000 end),
            crystals = crystals + (case v_quest.tier when 1 then 20 when 2 then 50 else 100 end)
        where auth_user_id = v_member.auth_user_id;

        if v_quest.tier = 2 then
          for v_i in 1..2 loop
            v_rune_type := 'slot' || (1 + floor(random() * 6))::int;
            v_rarity := (array['blue', 'purple'])[1 + floor(random() * 2)];
            v_rolled := case v_rarity when 'purple' then 6.8 else 4.8 end;
            insert into public.idle_player_runes (name_key, auth_user_id, rune_type, rarity, rolled_value)
            values (v_member.name_key, v_member.auth_user_id, v_rune_type, v_rarity, v_rolled);
          end loop;
        elsif v_quest.tier = 3 then
          v_rune_type := 'slot' || (1 + floor(random() * 6))::int;
          insert into public.idle_player_runes (name_key, auth_user_id, rune_type, rarity, rolled_value)
          values (v_member.name_key, v_member.auth_user_id, v_rune_type, 'gold', 10);

          insert into public.idle_prestige_state (name_key, display_name, prestige_points)
          values (v_member.name_key, v_member.display_name, 10)
          on conflict (name_key) do update set prestige_points = idle_prestige_state.prestige_points + 10;
        end if;
      end loop;
    end if;
  end loop;
end;
$$;
grant execute on function public.guild_quest_contribute(jsonb) to authenticated;
