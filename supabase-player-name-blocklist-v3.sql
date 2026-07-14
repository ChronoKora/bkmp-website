-- Bkmp - Namensfilter v3: erweiterte Sperrliste.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Braucht supabase-player-name-blocklist.sql (Grundtabelle + Trigger).
--
-- Spieler-Wunsch (14.07.): "Fuege bitte selbststaendig noch viel mehr
-- verbotene Woerter dazu" - proaktive Erweiterung ueber die bisher nur
-- reaktiv (nach konkreten Vorfaellen) eingetragenen Begriffe hinaus.
-- Bewusst zurueckhaltend bei generischen/kurzen Woertern (z. B. "fuehrer"
-- allein - ganz normales deutsches Wort in vielen harmlosen Kontexten,
-- "88" allein - haeufig in normalen Gamertags) um Falsch-Positive zu
-- vermeiden; alle Eintraege hier sind entweder Eigennamen, spezifische
-- Codes/Organisationen oder eindeutige zusammengesetzte Begriffe.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

insert into public.blocked_display_names (name_key, reason) values
  -- Weitere NS-Fuehrungsfiguren/Kriegsverbrecher
  ('rudolfhoess', 'NS-Kriegsverbrecher (Kommandant Auschwitz)'),
  ('hoess', 'NS-Kriegsverbrecher (Kommandant Auschwitz)'),
  ('martinbormann', 'NS-Führungsfigur'),
  ('bormann', 'NS-Führungsfigur'),
  ('reinhardheydrich', 'NS-Führungsfigur'),
  ('josefmengele', 'NS-Kriegsverbrecher'),
  ('rommel', 'NS-Wehrmacht (haeufig verherrlichend verwendet)'),
  -- NS-Organisationen/Begriffe
  ('drittesreich', 'NS-Symbolik'),
  ('endloesung', 'NS-Symbolik (Holocaust-Bezug)'),
  ('blutundboden', 'NS-Symbolik'),
  ('waffenss', 'NS-Organisation'),
  ('gestapo', 'NS-Organisation'),
  ('naziskin', 'Rechtsextreme Szene'),
  ('neonazi', 'Rechtsextreme Szene'),
  -- Hasscodes/Slogans
  ('14words', 'Bekannter Hasscode (White-Supremacist-Slogan)'),
  ('zog', 'Antisemitischer Verschwoerungsbegriff'),
  ('rahowa', 'Rechtsextremer Kampfbegriff ("Racial Holy War")'),
  ('whitepride', 'Rassistischer Slogan'),
  ('whitesupremacy', 'Rassistischer Slogan'),
  ('aryanbrotherhood', 'Rassistische Organisation'),
  -- Antisemitische Hetze
  ('gaskammer', 'Antisemitische Hetze/Holocaust-Verherrlichung'),
  ('gaschamber', 'Antisemitische Hetze/Holocaust-Verherrlichung'),
  ('jewkiller', 'Antisemitische Hetze')
on conflict (name_key) do nothing;
