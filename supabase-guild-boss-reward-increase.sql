-- Spieler-Wunsch (15.07.): Gildenboss-Belohnungspool erhoehen.
-- Bisher: 200.000 Gold + 1.000 Kristalle pro Sieg (insgesamt, anteilig
-- nach Schaden verteilt, siehe guild_boss_finish() in supabase-guild-boss.sql).
-- Neu: 5.000.000 Gold + 20.000 Kristalle.
--
-- Reine Datenaenderung, keine Funktionsaenderung noetig - guild_boss_finish()
-- liest gold_reward/gem_reward bereits dynamisch aus dieser Tabelle, ebenso
-- die client-seitige Ergebnisanzeige (loadGuildBossInstance()).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

update public.guild_bosses
set gold_reward = 5000000, gem_reward = 20000
where id = 'grimlok';
