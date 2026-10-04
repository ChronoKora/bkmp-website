-- ============================================================
-- Event-Ankuendigungs-Popup (04.10.2026) - "Das Erwachen des Zwielichts"
--
-- Das Website-Popup (js/systems/bkmp-event-announce.js) liest seine
-- Einstellungen aus special_events.config.announcementPopup - kein Event ist
-- im Code fest verdrahtet. Ein weiteres Event bekommt ein Popup, indem sein
-- config denselben Schluessel traegt (Grafik unter assets/events/).
--
-- Felder (alle Koordinaten in Pixeln der Grafik, width x height):
--   enabled    false/fehlt = kein Popup
--   daily      true = hoechstens 1x pro Berliner Kalendertag; false = nur 1x je Event
--   action     open_event (Idle-Dorf + Event-Fenster) | open_idle (nur Idle-Dorf)
--   image      relativer Pfad unter assets/ (?v=... zum Erneuern des Browser-Caches)
--   close      Mittelpunkt + Radius des X im Artwork
--   cta        Klickflaeche "Event ansehen" + Umriss (face) der Plakette
--   glows / sparks / twinkles   optionale, sehr leichte Zusatzeffekte
--
-- Das Popup erscheint nur, solange der Event-Status COMING_SOON oder LIVE
-- ist (Termine wie immer ueber special_event_schedule()). Ohne diese Datei
-- (und ohne den Schluessel in 20261004-07) erscheint einfach kein Popup.
--
-- Reihenfolge: nach 20261004-06 und -07. Idempotent. Enthaelt dieselbe
-- Konfiguration wie 20261004-07 (die Tests pruefen, dass beide identisch
-- bleiben) - -11 ist nur noetig, wenn -07 schon vor dieser Aenderung
-- ausgefuehrt wurde. -07 ueberschreibt config komplett: wer -07 spaeter
-- erneut ausfuehrt, braucht -11 nicht noch einmal (der Schluessel steckt
-- dann bereits in -07).
-- NOCH NICHT AUSGEFUEHRT.
-- ============================================================

update public.special_events
   set config = config || jsonb_build_object('announcementPopup', $ann${
 "enabled": true,
 "daily": true,
 "action": "open_event",
 "image": "assets/events/zwielicht-announcement.webp?v=1",
 "width": 1122,
 "height": 1402,
 "alt": "Das Erwachen des Zwielichts – 7-Tage-Event: Stufe 10 Dayman, Stufe 20 Surebrec, Stufe 30 Lightnix oder Darknix",
 "ctaLabel": "Zwielicht-Event ansehen",
 "closeLabel": "Event-Ankündigung schließen",
 "close": {
  "x": 1040,
  "y": 118,
  "r": 48
 },
 "cta": {
  "x": 282,
  "y": 1190,
  "w": 574,
  "h": 144,
  "face": [
   [
    346,
    1205
   ],
   [
    304,
    1262
   ],
   [
    346,
    1318
   ],
   [
    794,
    1318
   ],
   [
    836,
    1262
   ],
   [
    794,
    1205
   ]
  ]
 },
 "glows": [
  {
   "tone": "light",
   "x": 402,
   "y": 690,
   "r": 220
  },
  {
   "tone": "dark",
   "x": 736,
   "y": 690,
   "r": 220
  }
 ],
 "sparks": [
  {
   "tone": "light",
   "x": 70,
   "y": 330,
   "w": 400,
   "h": 680,
   "count": 7
  },
  {
   "tone": "dark",
   "x": 650,
   "y": 330,
   "w": 400,
   "h": 680,
   "count": 7
  }
 ],
 "twinkles": [
  [
   562,
   92
  ],
  [
   30,
   425
  ],
  [
   1092,
   425
  ],
  [
   62,
   1105
  ],
  [
   1060,
   1105
  ],
  [
   562,
   1332
  ]
 ]
}$ann$::jsonb)
 where id = 'zwielicht';

notify pgrst, 'reload schema';
