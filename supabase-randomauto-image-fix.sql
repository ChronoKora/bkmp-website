-- Bkmp - Fix: RandomAuto-Pluschie zeigt kaputtes Bild (Spieler-Meldung)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Tippfehler in der urspruenglichen Migration (supabase-adfree-easter-egg.sql):
-- image_url zeigte auf "RandomAutoo.png" (doppeltes o), die echte Datei
-- heisst aber "RandomAuto.png" (einfaches o). Die urspruengliche Zeile
-- existiert schon in der DB (on conflict do nothing greift bei einem
-- erneuten Ausfuehren also nicht) - deshalb hier ein gezieltes Update statt
-- eines erneuten Inserts.

update public.plushies
set image_url = 'assets/plushies/RandomAuto.png'
where id = 'randomauto';
