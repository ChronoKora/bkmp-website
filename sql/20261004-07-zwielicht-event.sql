-- ============================================================
-- Drachendorf-Ausbau Phase 8 (04.10.2026): Event-Daten
-- "DAS ERWACHEN DES ZWIELICHTS" (Zwielicht-Pass)
--
-- Legt das Event AUS (enabled = false, ohne Termine) an - es ist fuer
-- Spieler unsichtbar, bis der Betreiber den Montag festlegt:
--
--   select public.special_event_schedule('zwielicht', '2026-10-19', 3);
--     -> Ankuendigung Fr 16.10. 00:00, Start Mo 19.10. 00:00,
--        Ende So 25.10. 23:59 (Europe/Berlin)
--
-- Wieder ausschalten: update public.special_events set enabled = false where id = 'zwielicht';
-- Nach dem Event archivieren (Rueckblick bleibt sichtbar):
--   update public.special_events set archived = true where id = 'zwielicht';
--
-- Konfiguration (Quests, Stufenbelohnungen, Texte) steht als JSON unten
-- zwischen den $cfg$-Markierungen (Balance per Simulation, siehe
-- MASTER_DOKUMENTATION_BKINVESTMENT.md). Erneutes Ausfuehren aktualisiert
-- NUR Texte/Konfiguration, nie Termine oder den Schalter.
--
-- Voraussetzung: 20261003-dragon-species-neue-drachen2.sql (Arten dayman +
-- surebrec fuer die garantierten Eier) und 20261004-06-special-events.sql.
-- NOCH NICHT AUSGEFUEHRT.
-- Die Arten lightnix/darknix legt 20261004-08-lightnix-darknix.sql an.
-- ============================================================

-- Garantierte Pass-Eier (Stufe 10 = dayman, Stufe 20 = surebrec) brauchen die
-- echten Arten aus 20261003-dragon-species-neue-drachen2.sql. Fehlt eine,
-- bricht diese Datei ab, statt spaeter beim Abholen zu scheitern.
do $
begin
  if not exists (select 1 from public.dragon_species ds where ds.id = 'dayman')
     or not exists (select 1 from public.dragon_species ds where ds.id = 'surebrec') then
    raise exception 'Zwielicht-Pass: Drachenarten dayman/surebrec fehlen - bitte zuerst sql/20261003-dragon-species-neue-drachen2.sql ausfuehren.';
  end if;
end $;

insert into public.special_events (id, name, subtitle, description, lore, timezone, enabled, archived,
  tier_count, points_per_tier, config, reward_group, lifetime_claim_limit, choice_mode, reward_species, assets)
values (
  'zwielicht',
  '☀️🌑 Das Erwachen des Zwielichts',
  'Licht gegen Dunkelheit – eine siebentägige Prüfung',
  'Sieben Tage, 30 Stufen, tägliche Prüfungen und große Wochenquests. Wer Stufe 30 erreicht, wählt seinen Weg: ☀️ Lightnix oder 🌑 Darknix.',
  'Zwei uralte Drachen erwachen am Rand des Dorfes – einer aus dem ersten Licht des Morgens, einer aus der tiefsten Stunde der Nacht. Nur wer die Prüfung des Zwielichts besteht, darf sich einem von ihnen anschließen.',
  'Europe/Berlin', false, false, 30, 100,
  $cfg${
 "daily": {
  "normal_count": 4,
  "normal_points": 40,
  "hard_points": 90,
  "closure": {
   "need": 4,
   "points": 100,
   "name": "Tagesabschluss",
   "icon": "🌗"
  },
  "normal": [
   {
    "id": "d_kills",
    "name": "Drachenjäger",
    "metric": "kills",
    "target": 1500,
    "scale": true
   },
   {
    "id": "d_bosses",
    "name": "Bossbrecher",
    "metric": "bosses",
    "target": 15
   },
   {
    "id": "d_active",
    "name": "Veteran",
    "metric": "active",
    "target": 2700
   },
   {
    "id": "d_dungeons",
    "name": "Dungeonläufer",
    "metric": "dungeons",
    "target": 3
   },
   {
    "id": "d_tower",
    "name": "Turmstürmer",
    "metric": "tower",
    "target": 15
   },
   {
    "id": "d_runes",
    "name": "Runenschmied",
    "metric": "runes",
    "target": 15,
    "requires": "runes"
   },
   {
    "id": "d_feed",
    "name": "Drachenhüter",
    "metric": "feedings",
    "target": 8,
    "requires": "babies"
   },
   {
    "id": "d_exp",
    "name": "Entdecker",
    "metric": "expeditions",
    "target": 1,
    "requires": "harbor"
   },
   {
    "id": "d_guild",
    "name": "Gildenhelfer",
    "metric": "guild",
    "target": 10,
    "requires": "guild"
   },
   {
    "id": "d_world",
    "name": "Zeuge des Zwielichts",
    "metric": "world_events",
    "target": 2
   }
  ],
  "hard": [
   {
    "id": "h_kills",
    "name": "Schlacht im Zwielicht",
    "metric": "kills",
    "target": 4200,
    "scale": true
   },
   {
    "id": "h_active",
    "name": "Wache bis zur Dämmerung",
    "metric": "active",
    "target": 5400
   },
   {
    "id": "h_bosses",
    "name": "Bosse der Dämmerung",
    "metric": "bosses",
    "target": 45
   },
   {
    "id": "h_dungeons",
    "name": "Tiefen des Zwielichts",
    "metric": "dungeons",
    "target": 7
   }
  ]
 },
 "weekly": [
  {
   "id": "w_kills",
   "name": "Der große Drachenkrieg",
   "metric": "kills",
   "scale": true,
   "stages": [
    [
     6000,
     50
    ],
    [
     15000,
     60
    ],
    [
     30000,
     70
    ]
   ]
  },
  {
   "id": "w_bosses",
   "name": "Bezwinger des Zwielichts",
   "metric": "bosses",
   "stages": [
    [
     60,
     35
    ],
    [
     180,
     45
    ],
    [
     400,
     50
    ]
   ]
  },
  {
   "id": "w_active",
   "name": "Veteran des Zwielichts",
   "metric": "active",
   "stages": [
    [
     10800,
     50
    ],
    [
     21600,
     60
    ],
    [
     39600,
     70
    ]
   ]
  },
  {
   "id": "w_dungeons",
   "name": "Dungeonmeister",
   "metric": "dungeons",
   "stages": [
    [
     10,
     35
    ],
    [
     25,
     45
    ],
    [
     50,
     50
    ]
   ]
  },
  {
   "id": "w_tower",
   "name": "Gipfelstürmer",
   "metric": "tower",
   "stages": [
    [
     60,
     35
    ],
    [
     180,
     45
    ],
    [
     350,
     50
    ]
   ]
  },
  {
   "id": "w_runes",
   "name": "Runenmeister",
   "metric": "runes",
   "requires": "runes",
   "alt": "w_world",
   "stages": [
    [
     50,
     35
    ],
    [
     150,
     45
    ],
    [
     300,
     50
    ]
   ]
  },
  {
   "id": "w_feed",
   "name": "Drachenzüchter",
   "metric": "feedings",
   "requires": "babies",
   "alt": "w_hunt",
   "stages": [
    [
     20,
     35
    ],
    [
     60,
     45
    ],
    [
     120,
     50
    ]
   ]
  },
  {
   "id": "w_exp",
   "name": "Weltenwanderer",
   "metric": "expeditions",
   "requires": "harbor",
   "alt": "w_trials",
   "stages": [
    [
     3,
     35
    ],
    [
     8,
     45
    ],
    [
     14,
     50
    ]
   ]
  }
 ],
 "weekly_alts": [
  {
   "id": "w_world",
   "name": "Zeichen am Himmel",
   "metric": "world_events",
   "stages": [
    [
     6,
     35
    ],
    [
     18,
     45
    ],
    [
     40,
     50
    ]
   ]
  },
  {
   "id": "w_hunt",
   "name": "Jäger der Dämmerung",
   "metric": "bosses",
   "stages": [
    [
     40,
     35
    ],
    [
     120,
     45
    ],
    [
     260,
     50
    ]
   ]
  },
  {
   "id": "w_trials",
   "name": "Pfad der Prüfungen",
   "metric": "dungeons",
   "stages": [
    [
     6,
     35
    ],
    [
     18,
     45
    ],
    [
     36,
     50
    ]
   ]
  }
 ],
 "tiers": [
  {
   "tier": 1,
   "reward": {
    "gold_units": 120
   }
  },
  {
   "tier": 2,
   "reward": {
    "wood": 3000,
    "stone": 3000
   }
  },
  {
   "tier": 3,
   "reward": {
    "crystals": 60
   }
  },
  {
   "tier": 4,
   "reward": {
    "fruit": 150,
    "meat": 150
   }
  },
  {
   "tier": 5,
   "reward": {
    "label": "Kleine Zwielicht-Truhe",
    "gold_units": 300,
    "crystals": 120,
    "essence": 80,
    "runes": [
     {
      "count": 1,
      "tier": 1
     }
    ]
   }
  },
  {
   "tier": 6,
   "reward": {
    "essence": 70
   }
  },
  {
   "tier": 7,
   "reward": {
    "boosts": [
     "gold"
    ]
   }
  },
  {
   "tier": 8,
   "reward": {
    "gold_units": 180
   }
  },
  {
   "tier": 9,
   "reward": {
    "wood": 6000,
    "stone": 6000
   }
  },
  {
   "tier": 10,
   "reward": {
    "label": "Garantiertes Dayman-Ei + Titel „Zwielicht-Wanderer“",
    "unlock": "title_zwielicht",
    "species_eggs": [
     "dayman"
    ]
   }
  },
  {
   "tier": 11,
   "reward": {
    "runes": [
     {
      "count": 1,
      "tier": 1
     }
    ]
   }
  },
  {
   "tier": 12,
   "reward": {
    "essence": 100
   }
  },
  {
   "tier": 13,
   "reward": {
    "boosts": [
     "exp"
    ]
   }
  },
  {
   "tier": 14,
   "reward": {
    "gold_units": 240
   }
  },
  {
   "tier": 15,
   "reward": {
    "label": "Zwielicht-Abzeichen",
    "unlock": "badge_zwielicht",
    "crystals": 150
   }
  },
  {
   "tier": 16,
   "reward": {
    "fruit": 300,
    "meat": 300
   }
  },
  {
   "tier": 17,
   "reward": {
    "runes": [
     {
      "count": 1,
      "tier": 2
     }
    ]
   }
  },
  {
   "tier": 18,
   "reward": {
    "essence": 150
   }
  },
  {
   "tier": 19,
   "reward": {
    "gold_units": 300
   }
  },
  {
   "tier": 20,
   "reward": {
    "label": "Garantiertes Surebrec-Ei + Namensfarbe „Zwielicht“",
    "unlock": "cosmetic_zwielicht",
    "species_eggs": [
     "surebrec"
    ]
   }
  },
  {
   "tier": 21,
   "reward": {
    "crystals": 200
   }
  },
  {
   "tier": 22,
   "reward": {
    "boosts": [
     "gold",
     "exp"
    ]
   }
  },
  {
   "tier": 23,
   "reward": {
    "wood": 10000,
    "stone": 10000
   }
  },
  {
   "tier": 24,
   "reward": {
    "essence": 200
   }
  },
  {
   "tier": 25,
   "reward": {
    "label": "Große Zwielicht-Truhe",
    "gold_units": 600,
    "crystals": 300,
    "essence": 200,
    "runes": [
     {
      "count": 2,
      "tier": 2
     }
    ]
   }
  },
  {
   "tier": 26,
   "reward": {
    "gold_units": 350
   }
  },
  {
   "tier": 27,
   "reward": {
    "boosts": [
     "exp",
     "gold"
    ]
   }
  },
  {
   "tier": 28,
   "reward": {
    "label": "Schatz des Zwielichts",
    "runes": [
     {
      "count": 1,
      "tier": 3
     }
    ],
    "crystals": 500,
    "essence": 150
   }
  },
  {
   "tier": 29,
   "reward": {
    "label": "Das Zwielicht ruft …",
    "gold_units": 500,
    "essence": 300
   }
  },
  {
   "tier": 30,
   "reward": {
    "label": "Die Wahl des Zwielichts: ☀️ Lightnix oder 🌑 Darknix",
    "choice": true
   }
  }
 ],
 "texts": {
  "teaser_title": "☀️🌑 DAS ZWIELICHT NAHT",
  "teaser_lines": [
   "Zwei uralte Mächte nähern sich dem Drachendorf.",
   "Montag beginnt eine siebentägige Prüfung.",
   "30 Stufen. Tägliche Aufgaben. Eine Entscheidung.",
   "☀️ Licht oder 🌑 Dunkelheit?",
   "Nur wer das Ende des Pfades erreicht, darf wählen."
  ],
  "pass_name": "☀️🌑 Zwielicht-Pass",
  "points_name": "Zwielichtpunkte",
  "tier30_title": "✨ DAS ZWIELICHT WARTET",
  "tier30_text": "Erreiche Stufe 30 und entscheide deinen Weg.",
  "earned_title": "✨ DAS ZWIELICHT ANTWORTET",
  "end_not_earned": "Das Zwielicht ist vorüber.",
  "end_earned_open": "Du hast die Prüfung bestanden. Deine Wahl wartet.",
  "end_chosen": "Dein {species} begleitet dich weiterhin.",
  "website_points": [
   "30 Pass-Stufen mit Belohnungen auf dem ganzen Weg",
   "Garantierte Dracheneier: 🥚 Dayman auf Stufe 10 und 🥚 Surebrec auf Stufe 20 – keine Zufallseier",
   "Jeden Tag 5 neue Prüfungen + Tagesabschluss (Reset 00:00 Uhr)",
   "Große Wochenquests über die ganze Woche",
   "Hauptbelohnung auf Stufe 30: ☀️ Lightnix ODER 🌑 Darknix – du entscheidest selbst",
   "Nur ein Eventdrache pro Account",
   "Beide Drachen haben fünf Entwicklungsstufen: Ei, Baby, Jugendlich, Erwachsen und Göttlich",
   "Die göttliche Form wird später durch Bindung, gemeinsame Kämpfe und eine große Opfergabe erweckt",
   "Kostenlos – kein Echtgeld, keine gekauften Stufen"
  ],
  "faq": [
   [
    "Welche Dracheneier gibt es im Pass?",
    "Zwei feste Eier statt Zufall: Auf Stufe 10 ein Dayman-Ei, auf Stufe 20 ein Surebrec-Ei. Beide sind normale Drachenarten – du bekommst sie auch, wenn du schon einen Dayman oder Surebrec hast."
   ],
   [
    "Kann ich beide bekommen?",
    "Nein. Du wählst einen der beiden Drachen – Lightnix oder Darknix."
   ],
   [
    "Was muss ich bis Sonntag schaffen?",
    "Stufe 30 des Zwielicht-Passes."
   ],
   [
    "Muss ich bis Sonntag das Ei ausbrüten?",
    "Nein. Das Ei bleibt dir, du kannst es jederzeit ausbrüten."
   ],
   [
    "Muss ich bis Sonntag Göttlich werden?",
    "Nein. Die göttliche Form erreichst du später in deinem eigenen Tempo."
   ],
   [
    "Darf ich nach dem Event noch wählen?",
    "Ja – wenn du Stufe 30 rechtzeitig erreicht hast."
   ],
   [
    "Ist Göttlich stärker?",
    "Ja. Göttlich ist eine echte fünfte Entwicklungsstufe mit stärkeren Werten und einem eigenen Effekt."
   ],
   [
    "Kann ich Göttlich später erreichen?",
    "Ja. Es gibt keinen Zeitdruck – dein Drache bleibt dir für immer."
   ],
   [
    "Wie bekomme ich Zwielichtpunkte?",
    "Durch die täglichen Prüfungen, den Tagesabschluss und die Wochenquests. Kämpfe zählen nur, solange du wirklich spielst – Offline-Fortschritt zählt nicht."
   ]
  ]
 },
 "choices": {
  "lightnix": {
   "icon": "☀️",
   "name": "Lightnix",
   "theme": "Licht",
   "text": "Schutz, Stabilität und Unterstützung für dein ganzes Team. Göttlich: Aura des Lichts."
  },
  "darknix": {
   "icon": "🌑",
   "name": "Darknix",
   "theme": "Dunkelheit",
   "text": "Offensive, seltene Funde und gefährliche Expeditionen. Göttlich: Aura der Finsternis."
  }
 }
}$cfg$::jsonb,
  'zwielicht', 1, 'player_choice', array['lightnix', 'darknix'],
  '{"lightnix":"assets/dragons/breeding/adult/lightnix.png","darknix":"assets/dragons/breeding/adult/darknix.png","lightnix_divine":"assets/dragons/breeding/divine/lightnix.png","darknix_divine":"assets/dragons/breeding/divine/darknix.png"}'::jsonb
)
on conflict (id) do update set
  name = excluded.name, subtitle = excluded.subtitle, description = excluded.description, lore = excluded.lore,
  tier_count = excluded.tier_count, points_per_tier = excluded.points_per_tier, config = excluded.config,
  reward_group = excluded.reward_group, lifetime_claim_limit = excluded.lifetime_claim_limit,
  choice_mode = excluded.choice_mode, reward_species = excluded.reward_species, assets = excluded.assets;

notify pgrst, 'reload schema';
