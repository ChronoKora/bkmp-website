-- Bkmp - Idle Drachen Dorf: kumulative Lebenszeit-Stufenanzahl ueber
-- Prestige-Aufstiege hinweg.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Vorher wurden current_dragon_index/highest_dragon_index bei jedem
-- Prestige-Aufstieg komplett auf 0 zurueckgesetzt - dadurch ging die
-- Information "wie viele Stufen insgesamt (ueber alle Auffstiege hinweg)
-- schon geschafft wurden" verloren. prestige_stage_offset speichert die
-- Summe aller highest_dragon_index-Werte VOR jedem Reset; die im UI
-- angezeigte Lebenszeit-Stufenanzahl ist prestige_stage_offset +
-- highest_dragon_index (siehe bkmpIdleRenderStageBar in idledorf.js).
--
-- dragon_kills/boss_kills werden ab sofort NICHT mehr bei Prestige
-- zurueckgesetzt (siehe bkmpIdlePerformPrestige) - keine Spaltenaenderung
-- noetig, betrifft nur die JS-Logik. Das behebt nebenbei denselben
-- Reset-Effekt auf der Bestenliste (loadIdleLeaderboardStats liest
-- dragon_kills direkt).

alter table public.idle_player_state
  add column if not exists prestige_stage_offset bigint not null default 0;
