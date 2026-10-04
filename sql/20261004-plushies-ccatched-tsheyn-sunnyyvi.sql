-- Bkmp - 3 neue Pluschies: Ccatched, Tsheyn, Sunnyyvi (Spieler-Vorgabe 04.10.2026,
-- Ordner "Plueshie" mit 3 Bildern).
--
-- Die Bilder liegen bereits im Repo (assets/plushies/<Name>.png + -web.png/-web.webp,
-- 128px-Vorschau, freigestellt). Statt den "Ordner scannen"-Knopf im Admin-Panel zu
-- benutzen, legt diese Datei die drei Eintraege direkt an - exakt mit den Werten, die
-- der Scan ableiten wuerde (id aus dem Dateinamen, Name "<Name> Plueshie", Seltenheit
-- 'Episch', leere Beschreibung). Falls ein Plueshie 'Legendaer' sein soll: nur die
-- Spalte 'rarity' der jeweiligen Zeile aendern.
--
-- Wirkung: die Plueshies tauchen sofort in der Plueshie-Sammlung, im Admin-Code-Dropdown
-- ("Plueshie Codes") und - da der Beute-Pool von Weltboss/Gildenboss dynamisch aus der
-- Tabelle 'plushies' liest - automatisch im 5%-Plueshie-Drop auf. Fuer jedes Plueshie
-- entsteht ausserdem automatisch der zugehoerige Sammel-Erfolg.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent (on conflict do nothing): mehrfaches Ausfuehren schadet nicht und
-- ueberschreibt nichts, was du spaeter von Hand geaendert hast.

insert into public.plushies (id, name, image_url, description, rarity)
values
  ('ccatched', 'Ccatched Plüshie', 'assets/plushies/Ccatched.png', '', 'Episch'),
  ('tsheyn',   'Tsheyn Plüshie',   'assets/plushies/Tsheyn.png',   '', 'Episch'),
  ('sunnyyvi', 'Sunnyyvi Plüshie', 'assets/plushies/Sunnyyvi.png', '', 'Episch')
on conflict (id) do nothing;
