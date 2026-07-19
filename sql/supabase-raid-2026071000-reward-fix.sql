-- EINMALIGER Ausgleich fuer den gewonnenen Raid "2026071000".
-- Wegen eines Client-Bugs (der lokale Spielstand wusste nichts von der
-- serverseitig vergebenen Belohnung und der naechste normale Autosave hat
-- sie mit dem alten Stand ueberschrieben - siehe bkmpRaidSyncIdleStateAfterFinish
-- in idledorf.js) haben die 10 Teilnehmer dieses Raids ihre Belohnung
-- (50.000 Gold, 25 Kristalle, 5.000 XP, entspricht der raid_bosses-Konfig
-- zum Zeitpunkt des Sieges) nicht dauerhaft erhalten.
--
-- NICHT MEHRFACH AUSFUEHREN - dieses Skript schreibt die Belohnung ein
-- weiteres Mal gut, ein zweiter Lauf wuerde sie doppelt vergeben.

do $$
declare
  rec record;
begin
  for rec in
    select rp.auth_user_id, rp.display_name
    from public.raid_participants rp
    where rp.raid_id = '2026071000'
  loop
    update public.idle_player_state
    set gold = gold + 50000,
        total_gold_earned = total_gold_earned + 50000,
        crystals = crystals + 25,
        xp = xp + 5000
    where auth_user_id = rec.auth_user_id;
  end loop;
end $$;
