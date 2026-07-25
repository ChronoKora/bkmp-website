-- Bkmp - REINE VORSCHAU (read-only, keine Schreibzugriffe) fuer
-- sql/20260725-fix-rename-name-key-propagation.sql. Zeigt an, welche
-- Konten/Zeilen die Migration anfassen wuerde, OHNE irgendetwas zu
-- aendern. Gefahrlos beliebig oft ausfuehrbar.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

-- ============================================================
-- Abfrage 1: betroffene Konten, mit Anzahl Zeilen je Tabelle.
-- ============================================================
with latest_rename as (
  select distinct on (auth_user_id) auth_user_id, old_name, new_name, changed_at
  from public.player_name_history
  order by auth_user_id, changed_at desc
),
rune_mismatch as (
  select r.auth_user_id, count(*) as n
  from public.idle_player_runes r
  join public.player_stats ps on ps.auth_user_id = r.auth_user_id
  where r.name_key is distinct from ps.name_key
  group by r.auth_user_id
),
skin_mismatch as (
  select v.auth_user_id, count(*) as n
  from public.idle_player_village_skins v
  join public.player_stats ps on ps.auth_user_id = v.auth_user_id
  where v.name_key is distinct from ps.name_key
  group by v.auth_user_id
),
old_name_usage as (
  -- wie viele VERSCHIEDENE Konten haben diesen alten Namen jemals verlassen?
  select lower(old_name) as old_name_key, count(distinct auth_user_id) as distinct_owners
  from public.player_name_history
  group by lower(old_name)
),
rename_mapping as (
  select distinct on (lower(h.old_name))
    lower(h.old_name) as old_name_key, lower(h.new_name) as new_name_key, h.new_name
  from public.player_name_history h
  order by lower(h.old_name), h.changed_at desc
),
prestige_fixable as (
  -- NUR eindeutig zuordenbare Faelle (siehe Bedingungen in der Migration selbst)
  select ps2.auth_user_id, count(*) as n
  from public.idle_prestige_state p
  join rename_mapping m on m.old_name_key = p.name_key
  join old_name_usage u on u.old_name_key = p.name_key and u.distinct_owners = 1
  join public.player_stats ps2 on ps2.name_key = m.new_name_key
  where not exists (select 1 from public.player_stats ps3 where ps3.name_key = p.name_key)
    and not exists (select 1 from public.idle_prestige_state p2 where p2.name_key = m.new_name_key)
  group by ps2.auth_user_id
)
select
  ps.auth_user_id,
  lr.old_name as letzter_alter_name,
  ps.display_name as aktueller_name,
  coalesce(rm.n, 0) as betroffene_runenzeilen,
  coalesce(pf.n, 0) as betroffene_prestigezeilen,
  coalesce(sm.n, 0) as betroffene_dorfskinzeilen
from public.player_stats ps
left join latest_rename lr on lr.auth_user_id = ps.auth_user_id
left join rune_mismatch rm on rm.auth_user_id = ps.auth_user_id
left join skin_mismatch sm on sm.auth_user_id = ps.auth_user_id
left join prestige_fixable pf on pf.auth_user_id = ps.auth_user_id
where coalesce(rm.n, 0) + coalesce(pf.n, 0) + coalesce(sm.n, 0) > 0
order by ps.display_name;

-- ============================================================
-- Abfrage 2: verwaiste Prestige-Zeilen, die die Migration BEWUSST NICHT
-- automatisch anfasst, weil der alte Name mehrdeutig ist (wurde von mehr
-- als einem echten Konto irgendwann benutzt). Diese bleiben unangetastet -
-- nur zur eigenen Kenntnis/manuellen Pruefung, kein Fehler.
-- ============================================================
select
  p.name_key as verwaister_name,
  p.prestige_level,
  p.prestige_points,
  p.updated_at as zuletzt_geaendert
from public.idle_prestige_state p
where not exists (select 1 from public.player_stats ps where ps.name_key = p.name_key)
  and not exists (
    select 1
    from public.player_name_history h
    where lower(h.old_name) = p.name_key
      and (select count(distinct auth_user_id) from public.player_name_history h2 where lower(h2.old_name) = lower(h.old_name)) = 1
  )
order by p.updated_at desc;
