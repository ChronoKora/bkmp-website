-- Bkmp - REIN LESENDE DIAGNOSE fuer den erneuten Runenverlust-Report von
-- "BagonTr01" (29.07.2026, Feedback-Board: "Mal wieder eine Rune nach dem
-- Prestige weggebauggt :(").
--
-- KEINE Schreibzugriffe, KEINE Loeschungen, KEINE Korrekturen - jede Abfrage
-- unten ist ein reines SELECT. Gefahrlos beliebig oft ausfuehrbar.
-- Supabase Dashboard > SQL Editor > New query > Abschnitt fuer Abschnitt
-- ausfuehren.
--
-- Vorab-Pruefung im Code (OHNE DB-Zugriff, per Quellcode-Lektuere):
--  - bkmpPrestigeExecuteReset() (js/systems/bkmp-prestige.js) fasst Runen
--    an KEINER Stelle an - weder lokal noch per DB-Schreibzugriff. Die
--    18.07.-Entscheidung "Runen ueberleben Prestige vollstaendig" ist im
--    Code unveraendert wirksam (siehe Kommentar dort).
--  - EINZIGE Codepfade, die eine Rune tatsaechlich LOESCHEN koennen (siehe
--    bkmpRuneDeleteRemote() in js/systems/bkmp-runes.js): Aufstiegs-Fodder
--    (manuell + die am 27./28.07. NEU gebaute Automatik "Auto-Aufstieg"),
--    Verschmelzen (manuell + die neue Automatik "Auto-Verschmelzung"),
--    Einzelverkauf, Sammelverkauf nach Seltenheit. Alle IMMER mit
--    expliziter id-Liste, nie ein blindes "delete all".
--  - Die beiden neuen Automatiken sind AUSSCHLIESSLICH client-seitig per
--    localStorage aktiviert (bkmp-rune-auto-ascend-enabled/-fuse-enabled),
--    NICHT in der DB gespeichert - SQL allein kann deshalb nicht zeigen, ob
--    BagonTr01 sie eingeschaltet hat. Falls ja, waere das erwartetes (wenn
--    auch fuer den Spieler evtl. ueberraschendes) Verhalten, kein Bug -
--    "Auto-Aufstieg" verbraucht bewusst und unwiderruflich eine zweite
--    Legendaere pro Aufstieg, mit vorheriger einmaliger Bestaetigung beim
--    Einschalten.
--  - Kein Code-Pfad verbindet einen Prestige-Reset ursaechlich mit einer
--    dieser Automatiken - beide laufen unabhaengig auf einem eigenen 10s-
--    Automations-Takt (bkmpIdleRunAutomationToggles(), idledorf.js). Ein
--    zeitliches Zusammentreffen (Prestige kurz vor/nach einem Automatik-
--    Lauf) ist moeglich, aber kein ursaechlicher Zusammenhang.

-- ============================================================
-- ABSCHNITT 1 - Identitaet + juengste Aktivitaet
-- ============================================================

select
  ps.auth_user_id,
  ps.name_key,
  ps.display_name,
  ps.updated_at
from public.player_stats ps
where ps.name_key = 'bagontr01' or ps.display_name ilike '%bagon%';

-- Prestige-Historie: letzter Aufstiegszeitpunkt (fuer den zeitlichen
-- Abgleich mit der Runenliste unten).
select pps.name_key, pps.prestige_level, pps.prestige_points, pps.prestige_points_spent, pps.updated_at
from public.idle_prestige_state pps
where pps.name_key = 'bagontr01';

-- ============================================================
-- ABSCHNITT 2 - Vollstaendige aktuelle Runenliste, chronologisch
-- ============================================================
-- Zeigt jede einzelne Rune mit Zeitstempel - eine Luecke im Zeitverlauf
-- direkt VOR dem gemeldeten Vorfall (siehe Screenshot-Zeitpunkt im
-- Feedback-Eintrag) waere ein Hinweis auf einen echten, unerwuenschten
-- Verlust; ein sauberer, vollstaendiger 3er-/2er-Rest waere eher mit einer
-- der beiden neuen Automatiken vereinbar.
select
  r.id, r.rune_type, r.rarity, r.rolled_value, r.upgrade_level, r.equipped,
  r.created_at
from public.idle_player_runes r
where r.name_key = 'bagontr01'
order by r.created_at desc
limit 100;

-- Gruppierte Uebersicht (Anzahl je Seltenheit/Stufe) - schneller Blick auf
-- Auffaelligkeiten (z.B. genau EINE fehlende Legendaere waere klassisch
-- fuer eine einzelne Auto-Aufstieg-Ausfuehrung).
select r.rune_type, r.rarity, r.upgrade_level, r.equipped, count(*) as anzahl
from public.idle_player_runes r
where r.name_key = 'bagontr01'
group by r.rune_type, r.rarity, r.upgrade_level, r.equipped
order by r.rarity, r.rune_type, r.upgrade_level;

-- ============================================================
-- ABSCHNITT 3 - Kontext, den reines SQL nicht beantworten kann
-- ============================================================
-- Ob "Auto-Aufstieg"/"Auto-Verschmelzung" bei BagonTr01 aktiv sind, lebt
-- ausschliesslich in seinem eigenen Browser-localStorage - dafuer muesste
-- er direkt gefragt werden (Runen-Tab im Idle-Dorf, oben im Kopfbereich,
-- drei neue Haekchen "🥇 Auto-Legi-Aufwertung"/"🌟 Auto-Aufstieg"/
-- "🔥 Auto-Verschmelzung"). Kein SQL-Befehl kann das feststellen.
