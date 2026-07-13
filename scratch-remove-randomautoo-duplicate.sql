-- Einmaliger Korrektur-Befehl: "randomautoo" (Doppel-O) war ein
-- versehentliches Duplikat von "randomauto" (Easter-Egg-Plueschie, per
-- AD-Free-Popup automatisch eingeloest, siehe supabase-adfree-easter-egg.sql)
-- - entstanden durch den "Scan nach neuen Pluschie-Bildern"-Admin-Button,
-- BEVOR der Bild-Pfad-Dedup-Schutz eingebaut wurde (siehe Kommentar bei
-- admin.html Zeile ~3595). Beide Eintraege zeigen auf dieselbe Bilddatei
-- (assets/plushies/RandomAutoo.png), aber "randomautoo" war NICHT in
-- EXCLUDED_FROM_DAILY_POOL (api/generate-daily-events.js) enthalten und
-- landete faelschlich im normalen taeglichen Zufallspool.
--
-- Geprueft vor dem Loeschen (2026-07-12):
-- - Niemand hat aktuell active_plushie = 'randomautoo' gesetzt.
-- - Keine plushie_codes-Zeile referenziert 'randomautoo'.
-- - Einzige Besitzerin (Emsi3331) hat 'randomauto' (das echte Easter-Ei)
--   bereits separat unabhaengig freigeschaltet - verliert also nichts.

delete from public.user_plushies where plushie_id = 'randomautoo';
delete from public.plushies where id = 'randomautoo';
