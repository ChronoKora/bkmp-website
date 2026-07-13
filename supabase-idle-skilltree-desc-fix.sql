-- Bkmp - Idle Drachen Dorf: Skilltree-Beschreibungstexte an die bereits
-- LIVE laufende 4x-Raenge-Rebalance (supabase-idle-skilltree-extend.sql)
-- anpassen.
--
-- Bei der Rebalance wurden max_rank und effect_value_per_rank korrekt
-- umgerechnet (x4 Raenge, /4 Wert pro Rang - gleiche Maximalstaerke,
-- laengerer Weg dorthin). Die Beschreibungstexte selbst wurden dabei aber
-- NICHT mit angepasst - sie zeigen noch ueberall die ALTEN, 4x zu hohen
-- Werte pro Rang (z. B. "Klickkraft": Text sagt "+4%", tatsaechlich wirkt
-- nur +1% - effect_value_per_rank steht schon korrekt auf 1). Kein
-- Balance-Problem, reiner Text-Nachzieher.
--
-- Ausnahmen bewusst NICHT angefasst:
--  - Knoten ohne nackte Prozentzahl im Text (burg_reparatur/burg_schild/
--    magie_heilung/magie_runenglueck) - nichts zu korrigieren.
--  - Die festen Prozentwerte in den Magie-Text-Klammern (z. B. "60%
--    Angriff Extra-Schaden" bei Blitzschlag, "18%" beim Brand) - das sind
--    Konstanten direkt im Kampf-Code (idledorf.js), NICHT von
--    effect_value_per_rank abgeleitet, unveraendert korrekt.
--  - dorf_ballisten (ballista_unlock) und dorf_bogenschuetzen
--    (extra_archer): diese zwei Effekt-Typen werden im Code zusaetzlich
--    mit *8 bzw. *6 multipliziert (siehe bkmpIdleRecomputeEffectiveStats),
--    der Text-Wert ist also effect_value_per_rank * dieser Code-Faktor,
--    nicht der rohe Spaltenwert.
--
-- idempotent: mehrfaches Ausfuehren setzt lediglich dieselben Texte erneut.

update public.idle_skill_nodes set description = '+1,5% Leben pro Rang.' where id = 'burg_bollwerk';
update public.idle_skill_nodes set description = '+1,25% Verteidigung pro Rang.' where id = 'burg_eisentor';
update public.idle_skill_nodes set description = '+1,25% Leben pro Rang.' where id = 'burg_leben';
update public.idle_skill_nodes set description = '+1% Leben pro Rang (stapelt mit Mehr Leben).' where id = 'burg_mauern';
update public.idle_skill_nodes set description = '+1% Verteidigung pro Rang.' where id = 'burg_verteidigung';
update public.idle_skill_nodes set description = '+1% Verteidigung pro Rang (stapelt mit Verteidigung).' where id = 'burg_wachen';

update public.idle_skill_nodes set description = '+1% Angriffstempo pro Rang (kürzerer Auto-Angriff-Takt).' where id = 'dorf_angriffstempo';
update public.idle_skill_nodes set description = '+2 Angriff (fest) pro Rang, vor allen Prozent-Boni.' where id = 'dorf_ballisten';
update public.idle_skill_nodes set description = '+1,5% Angriff pro Rang (zusätzliche Bogenschützen).' where id = 'dorf_bogenschuetzen';
update public.idle_skill_nodes set description = '+1,5% Kritischer Schaden pro Rang.' where id = 'dorf_brandpfeile';
update public.idle_skill_nodes set description = '+1% Klick-Schaden pro Rang (oben auf die Basis von 12% Angriff pro Klick).' where id = 'dorf_klickkraft';
update public.idle_skill_nodes set description = '+1,25% Angriffstempo pro Rang.' where id = 'dorf_kriegshorn';
update public.idle_skill_nodes set description = '+0,38% Kritische-Treffer-Chance pro Rang.' where id = 'dorf_krit';
update public.idle_skill_nodes set description = '+1% Angriff pro Rang.' where id = 'dorf_meisterschuetzen';
update public.idle_skill_nodes set description = '+0,75% Angriff pro Rang.' where id = 'dorf_pfeilschaden';

update public.idle_skill_nodes set description = '+0,63% Lootchance pro Rang (stapelt).' where id = 'forsch_alchemie';
update public.idle_skill_nodes set description = '+1,25% XP pro Rang (stapelt).' where id = 'forsch_archive';
update public.idle_skill_nodes set description = '+0,63% Angriff pro Rang.' where id = 'forsch_drachenkunde';
update public.idle_skill_nodes set description = '+0,75% Gold pro Rang (eigener Bonus-Topf).' where id = 'forsch_gold';
update public.idle_skill_nodes set description = '+0,75% XP pro Rang (stapelt).' where id = 'forsch_kartografie';
update public.idle_skill_nodes set description = '+0,75% Lootchance pro Rang.' where id = 'forsch_loot';
update public.idle_skill_nodes set description = '+1% Angriff pro Rang (stapelt).' where id = 'forsch_meisterschmied';
update public.idle_skill_nodes set description = '+1% XP pro Rang.' where id = 'forsch_xp';

update public.idle_skill_nodes set description = '+0,5% Chance pro Rang auf einen Bonus-Blitzschlag (60% Angriff Extra-Schaden).' where id = 'magie_blitz';
update public.idle_skill_nodes set description = '+0,5% Chance pro Rang, den Gegenangriff des Drachen komplett auszusetzen.' where id = 'magie_eis';
update public.idle_skill_nodes set description = '+0,75% zusätzliche Blitz-Chance pro Rang (stapelt mit Blitzschlag).' where id = 'magie_erzmagier';
update public.idle_skill_nodes set description = '+0,5% Chance pro Rang auf einen Brand (4 Ticks lang je 18% Angriff Extra-Schaden).' where id = 'magie_feuer';
update public.idle_skill_nodes set description = '+0,75% zusätzliche Feuer-Chance pro Rang (stapelt mit Feuer).' where id = 'magie_meister';
update public.idle_skill_nodes set description = '+2% Kritischer Schaden pro Rang (stapelt mit Brandpfeile).' where id = 'magie_portal';
update public.idle_skill_nodes set description = '+0,75% Schadensreduktion pro Rang gegen den Gegenangriff des Drachen.' where id = 'magie_resistenz';

update public.idle_skill_nodes set description = '+1,25% Offline-Effizienz pro Rang (stapelt).' where id = 'wirt_expedition';
update public.idle_skill_nodes set description = '+1% Gold pro Rang.' where id = 'wirt_gold';
update public.idle_skill_nodes set description = '+0,75% Gold pro Rang (stapelt mit Goldproduktion).' where id = 'wirt_handel';
update public.idle_skill_nodes set description = '+1% Holz pro Rang.' where id = 'wirt_holz';
update public.idle_skill_nodes set description = '+0,75% Holz pro Rang (stapelt mit Holzproduktion).' where id = 'wirt_lager';
update public.idle_skill_nodes set description = '+1,25% Offline-Effizienz pro Rang.' where id = 'wirt_offline';
update public.idle_skill_nodes set description = '+1,25% Gold pro Rang (stapelt).' where id = 'wirt_schatzkammer';
update public.idle_skill_nodes set description = '+1% Stein pro Rang.' where id = 'wirt_stein';
