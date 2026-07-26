/* ============================================================
   Bkmp - Gilden-Technologie v2: Rebalance + Paragon-Fortfuehrung
   (26.07.2026, direktes Spieler-Feedback: "Für danach höhere Caps.. die
   neuen Skills kann ich jetzt schon ohne Probleme wieder durchkaufen.
   Haben noch 2320.99M gold auf der Bank" - alle 10 neuen Zweige aus
   sql/20260726-guild-tech-branches-v2.sql waren bei einer Multi-
   Milliarden-Kasse mit zusammen nur ca. 40M Gold komplett durchkaufbar).

   Baut auf sql/20260726-guild-tech-branches-v2.sql auf (muss vorher
   gelaufen sein). Diese Datei ersetzt NUR die CASE-Zuordnung in
   guild_tech_upgrade() erneut per "create or replace function" - die
   9 urspruenglichen STANDARD-Zweige (attack/defense/gold/crit_chance/
   crit_damage/boss_damage/rune_luck/xp/prestige) bleiben ZAHLEN-IDENTISCH
   unangetastet.

   Aenderungen:
   1) Maximalstufe/Kostenkurve der 8 nicht-TOGGLE neuen Zweige deutlich
      angehoben (LOW 5->15 Stufen, MED 10->25 Stufen, STANDARD_V2 als
      EIGENE, von der urspruenglichen STANDARD-Kurve der alten 9 Zweige
      GETRENNTE 35-Stufen-Kopie fuer Brutbeschleuniger/Gildenschmiede) -
      Maxen ALLER 10 neuen Zweige kostet jetzt zusammen ca. 4,36 Mrd. Gold
      statt ca. 40M.
   2) Die 2 TOGGLE-Zweige (Streak-Schutz/Willkommenspaket) bleiben bei
      Maximalstufe 1 (reiner Ein/Aus-Schalter - "mehr Stufen" ergibt hier
      keinen Sinn), aber der feste Preis steigt von 1,5M auf 8M.
   3) NEU: Paragon-Fortfuehrung fuer die 8 dafuer geeigneten Zweige (nicht
      die 2 TOGGLE-Zweige) - nach der (jetzt hoeheren) Maximalstufe kann
      mit stark steigenden Kosten "unendlich" weitergekauft werden (harte
      Sicherheitsgrenze bei Paragon-Rang 1000). Gespeichert als eigene,
      synthetische tech_id "<id>__paragon" im bereits bestehenden flachen
      guild_tech_levels-Schema (identisches Prinzip wie __dragon_souls/
      __ascension_level im Spieler-Prestige-JSONB) - KEINE neue Tabelle/
      Spalte noetig. Kostenkurve setzt nahtlos an der letzten normalen
      Stufe an (Basiswerte hier bewusst als vorab in Node berechnete,
      feste Literale hinterlegt statt einer dynamischen Kreuzreferenz auf
      die Basis-Zweig-Konstanten - haelt die CASE-Struktur identisch zum
      bestehenden Muster, siehe js/systems/bkmp-guild.js fuer die
      identisch nachgerechnete Client-Formel bkmpGuildTechParagonCost()).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (create or replace function).
   ============================================================ */

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
  v_max_level int;
  v_base_cost numeric;
  v_growth numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  case p_tech_id
    -- Urspruengliche 9 Zweige - ZAHLEN-IDENTISCH zu vorher, unangetastet.
    when 'attack', 'defense', 'gold', 'crit_chance', 'crit_damage', 'boss_damage', 'rune_luck', 'xp', 'prestige' then
      v_max_level := 20; v_base_cost := 200000; v_growth := 1.4;

    -- LOW (Kriegsrat/Aufstiegsvorbereitung): 5->15 Stufen.
    when 'guild_kriegsrat', 'guild_aufstiegsvorbereitung' then
      v_max_level := 15; v_base_cost := 600000; v_growth := 1.5;
    -- MED (Turm-Vorreiter/Gilden-Autokauf/Nachtwache/Stadtmauer): 10->25 Stufen.
    when 'guild_turm_vorreiter', 'guild_autokauf', 'guild_nachtwache', 'guild_stadtmauer' then
      v_max_level := 25; v_base_cost := 350000; v_growth := 1.28;
    -- STANDARD_V2 (Brutbeschleuniger/Gildenschmiede) - EIGENE 35-Stufen-Kurve,
    -- getrennt von der STANDARD-Kurve der alten 9 Zweige oben.
    when 'guild_brutbeschleuniger', 'guild_schmiede' then
      v_max_level := 35; v_base_cost := 250000; v_growth := 1.18;
    -- TOGGLE (Streak-Schutz/Willkommenspaket): weiterhin Stufe 0/1, Preis 1,5M -> 8M.
    when 'guild_streak_schutz', 'guild_willkommenspaket' then
      v_max_level := 1; v_base_cost := 8000000; v_growth := 1;

    -- Paragon-Fortfuehrung (max. Rang 1000) - Basiswerte = letzte normale
    -- Stufe * (Basiswachstum+0,15), identisch zur Client-Formel
    -- bkmpGuildTechParagonCost() nachgerechnet (siehe dortiger Kommentar).
    when 'guild_kriegsrat__paragon', 'guild_aufstiegsvorbereitung__paragon' then
      v_max_level := 1000; v_base_cost := 289009968; v_growth := 1.65;
    when 'guild_turm_vorreiter__paragon', 'guild_autokauf__paragon', 'guild_nachtwache__paragon', 'guild_stadtmauer__paragon' then
      v_max_level := 1000; v_base_cost := 187259282; v_growth := 1.43;
    when 'guild_brutbeschleuniger__paragon', 'guild_schmiede__paragon' then
      v_max_level := 1000; v_base_cost := 92422965; v_growth := 1.33;

    else
      raise exception 'invalid_tech';
  end case;

  select guild_id, role, display_name into v_guild_id, v_my_role, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null or v_my_role not in ('leader', 'officer') then raise exception 'not_authorized'; end if;

  select coalesce(level, 0) into v_current_level from public.guild_tech_levels where guild_id = v_guild_id and tech_id = p_tech_id;
  v_current_level := coalesce(v_current_level, 0);
  if v_current_level >= v_max_level then raise exception 'max_level'; end if;

  /* Paragon-Zweige duerfen erst gekauft werden, wenn die zugehoerige
     normale Stufe bereits voll ist - sonst koennte ein Zweig die teure
     Paragon-Kurve nutzen, ohne je die (guenstigere) normale Maximalstufe
     erreicht zu haben. */
  if right(p_tech_id, 9) = '__paragon' then
    declare
      v_base_tech_id text := left(p_tech_id, length(p_tech_id) - length('__paragon'));
      v_base_max_level int;
      v_base_current_level int;
    begin
      select case v_base_tech_id
        when 'guild_kriegsrat' then 15 when 'guild_aufstiegsvorbereitung' then 15
        when 'guild_turm_vorreiter' then 25 when 'guild_autokauf' then 25
        when 'guild_nachtwache' then 25 when 'guild_stadtmauer' then 25
        when 'guild_brutbeschleuniger' then 35 when 'guild_schmiede' then 35
        else null end into v_base_max_level;
      select coalesce(level, 0) into v_base_current_level from public.guild_tech_levels where guild_id = v_guild_id and tech_id = v_base_tech_id;
      if v_base_max_level is null or coalesce(v_base_current_level, 0) < v_base_max_level then
        raise exception 'base_not_maxed';
      end if;
    end;
  end if;

  v_cost := round(v_base_cost * power(v_growth, v_current_level));
  select guilds.treasury_gold into v_treasury from public.guilds where id = v_guild_id;
  if v_treasury is null or v_treasury < v_cost then raise exception 'insufficient_treasury'; end if;

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
