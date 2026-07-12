-- Bkmp - Idle Drachen Dorf: Skilltree-Beschreibungen ueberarbeitet.
-- Vorher reine Flavor-Texte (teils irrefuehrend, z.B. "Brandpfeile" klang
-- nach Feuerschaden-ueber-Zeit, wirkt aber tatsaechlich als Krit-Schaden-
-- Bonus) - jetzt kompakt und direkt der echte Effekt pro Rang, damit man
-- im Skilltree selbst sofort sieht, was ein Knoten wirklich bringt.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

-- Dorf
update public.idle_skill_nodes set description = '+3% Angriff pro Rang.' where id = 'dorf_pfeilschaden';
update public.idle_skill_nodes set description = '+4% Angriffstempo pro Rang (kürzerer Auto-Angriff-Takt).' where id = 'dorf_angriffstempo';
update public.idle_skill_nodes set description = '+1,5% Kritische-Treffer-Chance pro Rang.' where id = 'dorf_krit';
update public.idle_skill_nodes set description = '+6% Kritischer Schaden pro Rang.' where id = 'dorf_brandpfeile';
update public.idle_skill_nodes set description = '+6% Angriff pro Rang (zusätzliche Bogenschützen).' where id = 'dorf_bogenschuetzen';
update public.idle_skill_nodes set description = '+8 Angriff (fest) pro Rang, vor allen Prozent-Boni.' where id = 'dorf_ballisten';
update public.idle_skill_nodes set description = '+4% Angriff pro Rang.' where id = 'dorf_meisterschuetzen';
update public.idle_skill_nodes set description = '+5% Angriffstempo pro Rang.' where id = 'dorf_kriegshorn';
update public.idle_skill_nodes set description = '+4% Klick-Schaden pro Rang (oben auf die Basis von 12% Angriff pro Klick).' where id = 'dorf_klickkraft';

-- Burg
update public.idle_skill_nodes set description = '+5% Leben pro Rang.' where id = 'burg_leben';
update public.idle_skill_nodes set description = '+4% Verteidigung pro Rang.' where id = 'burg_verteidigung';
update public.idle_skill_nodes set description = 'Passive Leben-Regeneration pro Kampf-Tick (Anteil, zusammen mit Reparaturtempo & Heilung).' where id = 'burg_schild';
update public.idle_skill_nodes set description = 'Passive Leben-Regeneration pro Kampf-Tick (Anteil, zusammen mit Schildgenerator & Heilung).' where id = 'burg_reparatur';
update public.idle_skill_nodes set description = '+4% Leben pro Rang (stapelt mit Mehr Leben).' where id = 'burg_mauern';
update public.idle_skill_nodes set description = '+4% Verteidigung pro Rang (stapelt mit Verteidigung).' where id = 'burg_wachen';
update public.idle_skill_nodes set description = '+6% Leben pro Rang.' where id = 'burg_bollwerk';
update public.idle_skill_nodes set description = '+5% Verteidigung pro Rang.' where id = 'burg_eisentor';

-- Wirtschaft
update public.idle_skill_nodes set description = '+4% Gold pro Rang.' where id = 'wirt_gold';
update public.idle_skill_nodes set description = '+4% Holz pro Rang.' where id = 'wirt_holz';
update public.idle_skill_nodes set description = '+4% Stein pro Rang.' where id = 'wirt_stein';
update public.idle_skill_nodes set description = '+5% Offline-Effizienz pro Rang.' where id = 'wirt_offline';
update public.idle_skill_nodes set description = '+3% Gold pro Rang (stapelt mit Goldproduktion).' where id = 'wirt_handel';
update public.idle_skill_nodes set description = '+3% Holz pro Rang (stapelt mit Holzproduktion).' where id = 'wirt_lager';
update public.idle_skill_nodes set description = '+5% Gold pro Rang (stapelt).' where id = 'wirt_schatzkammer';
update public.idle_skill_nodes set description = '+5% Offline-Effizienz pro Rang (stapelt).' where id = 'wirt_expedition';

-- Forschung
update public.idle_skill_nodes set description = '+4% XP pro Rang.' where id = 'forsch_xp';
update public.idle_skill_nodes set description = '+3% Gold pro Rang (eigener Bonus-Topf).' where id = 'forsch_gold';
update public.idle_skill_nodes set description = '+3% Lootchance pro Rang.' where id = 'forsch_loot';
update public.idle_skill_nodes set description = '+2,5% Angriff pro Rang.' where id = 'forsch_drachenkunde';
update public.idle_skill_nodes set description = '+2,5% Lootchance pro Rang (stapelt).' where id = 'forsch_alchemie';
update public.idle_skill_nodes set description = '+3% XP pro Rang (stapelt).' where id = 'forsch_kartografie';
update public.idle_skill_nodes set description = '+4% Angriff pro Rang (stapelt).' where id = 'forsch_meisterschmied';
update public.idle_skill_nodes set description = '+5% XP pro Rang (stapelt).' where id = 'forsch_archive';

-- Magie
update public.idle_skill_nodes set description = '+2% Chance pro Rang auf einen Bonus-Blitzschlag (60% Angriff Extra-Schaden).' where id = 'magie_blitz';
update public.idle_skill_nodes set description = '+2% Chance pro Rang, den Gegenangriff des Drachen komplett auszusetzen.' where id = 'magie_eis';
update public.idle_skill_nodes set description = '+2% Chance pro Rang auf einen Brand (4 Ticks lang je 18% Angriff Extra-Schaden).' where id = 'magie_feuer';
update public.idle_skill_nodes set description = 'Passive Leben-Regeneration pro Kampf-Tick (Anteil, zusammen mit Schildgenerator & Reparaturtempo).' where id = 'magie_heilung';
update public.idle_skill_nodes set description = '+3% Schadensreduktion pro Rang gegen den Gegenangriff des Drachen.' where id = 'magie_resistenz';
update public.idle_skill_nodes set description = '+3% zusätzliche Feuer-Chance pro Rang (stapelt mit Feuer).' where id = 'magie_meister';
update public.idle_skill_nodes set description = '+3% zusätzliche Blitz-Chance pro Rang (stapelt mit Blitzschlag).' where id = 'magie_erzmagier';
update public.idle_skill_nodes set description = '+8% Kritischer Schaden pro Rang (stapelt mit Brandpfeile).' where id = 'magie_portal';
