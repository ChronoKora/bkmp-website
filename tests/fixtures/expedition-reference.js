/* Drachendorf-Ausbau Phase 3 (04.10.2026): 1:1-Spiegel der Katalogzeilen aus
   sql/20261004-03-expeditions.sql (Regionen, Missionen, Ereignisse).
   tests/e2e/expeditions.spec.js vergleicht diese Werte automatisch mit der
   SQL-Datei - eine Abweichung faellt dadurch sofort auf. */

const EXPEDITION_REGIONS = [
  {
    "id": "fluesterwald",
    "name": "Flüsterwald",
    "icon": "🌲",
    "description": "Ein uralter Wald voller Holz, wilder Früchte und vergessener Pfade.",
    "min_harbor_level": 1,
    "rune_tier": 0,
    "egg_tier": 1,
    "sort_order": 1
  },
  {
    "id": "glutberge",
    "name": "Glutberge",
    "icon": "🌋",
    "description": "Glühende Hänge mit Goldadern, Kristallhöhlen und Essenzquellen.",
    "min_harbor_level": 1,
    "rune_tier": 0,
    "egg_tier": 1,
    "sort_order": 2
  },
  {
    "id": "frostklamm",
    "name": "Frostklamm",
    "icon": "❄️",
    "description": "Eisige Schluchten, in denen Kristalle und alte Runen schlummern.",
    "min_harbor_level": 2,
    "rune_tier": 1,
    "egg_tier": 1,
    "sort_order": 3
  },
  {
    "id": "endriss",
    "name": "Endriss",
    "icon": "🌌",
    "description": "Ein Riss im Himmel. Wer zurückkehrt, bringt seltene Runen und Eier mit.",
    "min_harbor_level": 2,
    "rune_tier": 2,
    "egg_tier": 2,
    "sort_order": 4
  },
  {
    "id": "verbotenes_tal",
    "name": "Verbotenes Drachental",
    "icon": "🐲",
    "description": "Die Heimat der ältesten Drachen. Nur der große Hafen kennt den Weg.",
    "min_harbor_level": 3,
    "rune_tier": 3,
    "egg_tier": 3,
    "sort_order": 5
  }
];

const EXPEDITION_MISSIONS = [
  {
    "id": "fw_waldrand",
    "region_id": "fluesterwald",
    "name": "Holz am Waldrand",
    "description": "Ein ruhiger Flug zum Waldrand - ideal für einen einzelnen Drachen.",
    "duration_hours": 1,
    "team_size": 1,
    "requirements": {},
    "recommendations": [
      {
        "type": "affinity",
        "value": "erde"
      },
      {
        "type": "affinity",
        "value": "wind"
      }
    ],
    "rewards": {
      "gold_units": 20,
      "wood": 100,
      "fruit": 60,
      "bond_xp": 10
    },
    "sort_order": 1,
    "active": true
  },
  {
    "id": "fw_beerenpfad",
    "region_id": "fluesterwald",
    "name": "Der Beerenpfad",
    "description": "Zwei Drachen sammeln Beeren und Holz entlang der alten Pfade.",
    "duration_hours": 4,
    "team_size": 2,
    "requirements": {
      "distinct_species_min": 2
    },
    "recommendations": [
      {
        "type": "affinity",
        "value": "wind"
      },
      {
        "type": "trait",
        "value": "sammler"
      }
    ],
    "rewards": {
      "gold_units": 70,
      "wood": 350,
      "fruit": 250,
      "bond_xp": 30
    },
    "sort_order": 2,
    "active": true
  },
  {
    "id": "fw_tiefer_wald",
    "region_id": "fluesterwald",
    "name": "Tief im Flüsterwald",
    "description": "Eine lange Reise ins Herz des Waldes. Erfahrene Standarddrachen kennen den Weg.",
    "duration_hours": 8,
    "team_size": 3,
    "requirements": {
      "rarity_min": {
        "standard": 1
      }
    },
    "recommendations": [
      {
        "type": "affinity",
        "value": "erde"
      },
      {
        "type": "distinct_affinities",
        "value": 3
      }
    ],
    "rewards": {
      "gold_units": 140,
      "wood": 700,
      "fruit": 450,
      "egg_chance": 0.05,
      "bond_xp": 50
    },
    "sort_order": 3,
    "active": true
  },
  {
    "id": "gb_lavafelder",
    "region_id": "glutberge",
    "name": "Lavafelder",
    "description": "Ein Feuerdrache sucht in den Lavafeldern nach Gold und Essenz.",
    "duration_hours": 1,
    "team_size": 1,
    "requirements": {
      "affinity_min": {
        "feuer": 1
      }
    },
    "recommendations": [
      {
        "type": "trait",
        "value": "schatzsucher"
      }
    ],
    "rewards": {
      "gold_units": 25,
      "essence": 5,
      "bond_xp": 10
    },
    "sort_order": 4,
    "active": true
  },
  {
    "id": "gb_kristallhoehle",
    "region_id": "glutberge",
    "name": "Kristallhöhlen",
    "description": "Zwei Drachen verschiedener Elemente erkunden die Höhlen.",
    "duration_hours": 4,
    "team_size": 2,
    "requirements": {
      "distinct_affinities_min": 2
    },
    "recommendations": [
      {
        "type": "affinity",
        "value": "feuer"
      },
      {
        "type": "affinity",
        "value": "erde"
      }
    ],
    "rewards": {
      "gold_units": 70,
      "crystals": 22,
      "stone": 350,
      "bond_xp": 30
    },
    "sort_order": 5,
    "active": true
  },
  {
    "id": "gb_glutkern",
    "region_id": "glutberge",
    "name": "Der Glutkern",
    "description": "Bis zum glühenden Kern des Berges - höchstens ein legendärer Drache darf mit.",
    "duration_hours": 8,
    "team_size": 3,
    "requirements": {
      "affinity_min": {
        "feuer": 1
      },
      "rarity_max": {
        "legendaer": 1
      }
    },
    "recommendations": [
      {
        "type": "affinity_count",
        "value": "feuer",
        "count": 2
      },
      {
        "type": "trait",
        "value": "mutig"
      }
    ],
    "rewards": {
      "gold_units": 150,
      "essence": 40,
      "crystals": 30,
      "bond_xp": 50
    },
    "sort_order": 6,
    "active": true
  },
  {
    "id": "fk_eisgrat",
    "region_id": "frostklamm",
    "name": "Eisgrat",
    "description": "Ein kurzer Erkundungsflug über den Eisgrat.",
    "duration_hours": 1,
    "team_size": 1,
    "requirements": {},
    "recommendations": [
      {
        "type": "affinity",
        "value": "wasser"
      },
      {
        "type": "affinity",
        "value": "wind"
      }
    ],
    "rewards": {
      "crystals": 8,
      "stone": 100,
      "bond_xp": 10
    },
    "sort_order": 7,
    "active": true
  },
  {
    "id": "fk_frostwaechter",
    "region_id": "frostklamm",
    "name": "Die Frostwächter",
    "description": "Alte Eiswächter bewachen vergessene Runen.",
    "duration_hours": 4,
    "team_size": 2,
    "requirements": {
      "affinity_min": {
        "wasser": 1
      }
    },
    "recommendations": [
      {
        "type": "distinct_affinities",
        "value": 2
      },
      {
        "type": "trait",
        "value": "forscher"
      }
    ],
    "rewards": {
      "gold_units": 50,
      "crystals": 32,
      "rune_chance": 0.25,
      "bond_xp": 30
    },
    "sort_order": 8,
    "active": true
  },
  {
    "id": "fk_gletscherherz",
    "region_id": "frostklamm",
    "name": "Gletscherherz",
    "description": "Drei verschiedene Drachen suchen das Herz des Gletschers.",
    "duration_hours": 8,
    "team_size": 3,
    "requirements": {
      "distinct_species_min": 3
    },
    "recommendations": [
      {
        "type": "affinity",
        "value": "wasser"
      },
      {
        "type": "affinity",
        "value": "wind"
      },
      {
        "type": "affinity",
        "value": "licht"
      }
    ],
    "rewards": {
      "crystals": 70,
      "essence": 20,
      "rune_chance": 0.75,
      "bond_xp": 50
    },
    "sort_order": 9,
    "active": true
  },
  {
    "id": "er_leuchtfeuer",
    "region_id": "endriss",
    "name": "Leuchtfeuer am Rand",
    "description": "Ein Drache hält Wache am Rand des Risses.",
    "duration_hours": 1,
    "team_size": 1,
    "requirements": {},
    "recommendations": [
      {
        "type": "affinity",
        "value": "licht"
      }
    ],
    "rewards": {
      "essence": 8,
      "crystals": 8,
      "bond_xp": 10
    },
    "sort_order": 10,
    "active": true
  },
  {
    "id": "er_sternenstaub",
    "region_id": "endriss",
    "name": "Sternenstaub",
    "description": "Zwei Drachen sammeln Sternenstaub zwischen den Welten.",
    "duration_hours": 4,
    "team_size": 2,
    "requirements": {
      "distinct_affinities_min": 2
    },
    "recommendations": [
      {
        "type": "affinity",
        "value": "arkan"
      },
      {
        "type": "affinity",
        "value": "dunkel"
      }
    ],
    "rewards": {
      "essence": 32,
      "crystals": 32,
      "rune_chance": 0.35,
      "bond_xp": 30
    },
    "sort_order": 11,
    "active": true
  },
  {
    "id": "er_himmelsriss",
    "region_id": "endriss",
    "name": "Durch den Himmelsriss",
    "description": "Eine gefährliche Reise durch den Riss. Ein vielfältiges Team kehrt mit Schätzen zurück.",
    "duration_hours": 8,
    "team_size": 3,
    "requirements": {
      "distinct_affinities_min": 3
    },
    "recommendations": [
      {
        "type": "affinity",
        "value": "licht"
      },
      {
        "type": "affinity",
        "value": "dunkel"
      },
      {
        "type": "rarity",
        "value": "episch"
      }
    ],
    "rewards": {
      "gold_units": 100,
      "essence": 60,
      "crystals": 60,
      "rune_chance": 0.75,
      "egg_chance": 0.1,
      "bond_xp": 50
    },
    "sort_order": 12,
    "active": true
  },
  {
    "id": "vt_waechterflug",
    "region_id": "verbotenes_tal",
    "name": "Wächterflug",
    "description": "Ein Drache patrouilliert an der Grenze des Tals.",
    "duration_hours": 1,
    "team_size": 1,
    "requirements": {},
    "recommendations": [
      {
        "type": "rarity",
        "value": "legendaer"
      }
    ],
    "rewards": {
      "gold_units": 40,
      "crystals": 12,
      "essence": 10,
      "bond_xp": 10
    },
    "sort_order": 13,
    "active": true
  },
  {
    "id": "vt_ahnenschrein",
    "region_id": "verbotenes_tal",
    "name": "Schrein der Ahnen",
    "description": "Zwei eng verbundene Drachen besuchen den Schrein der Ahnen.",
    "duration_hours": 4,
    "team_size": 2,
    "requirements": {},
    "recommendations": [
      {
        "type": "affinity",
        "value": "arkan"
      },
      {
        "type": "bond",
        "value": 4
      }
    ],
    "rewards": {
      "gold_units": 110,
      "essence": 50,
      "crystals": 45,
      "rune_chance": 0.4,
      "bond_xp": 30
    },
    "sort_order": 14,
    "active": true
  },
  {
    "id": "vt_drachenhort",
    "region_id": "verbotenes_tal",
    "name": "Der Drachenhort",
    "description": "Der legendäre Hort. Nur ein Team aus drei verschiedenen Arten und Elementen findet ihn.",
    "duration_hours": 8,
    "team_size": 3,
    "requirements": {
      "distinct_species_min": 3,
      "distinct_affinities_min": 3
    },
    "recommendations": [
      {
        "type": "affinity",
        "value": "licht"
      },
      {
        "type": "affinity",
        "value": "dunkel"
      },
      {
        "type": "bond",
        "value": 6
      }
    ],
    "rewards": {
      "gold_units": 260,
      "crystals": 110,
      "essence": 90,
      "rune_chance": 1,
      "egg_chance": 0.15,
      "bond_xp": 50
    },
    "sort_order": 15,
    "active": true
  }
];

const EXPEDITION_EVENTS = [
  {
    "id": "schatztruhe",
    "name": "Alte Schatztruhe",
    "icon": "💰",
    "description": "Unter Wurzeln vergraben lag eine alte Truhe voller Gold.",
    "base_chance": 0.12,
    "affinity_bonus": {
      "erde": 0.03
    },
    "trait_bonus": {
      "schatzsucher": 0.1
    },
    "reward": {
      "gold_units": 60
    },
    "sort_order": 1
  },
  {
    "id": "kristallader",
    "name": "Kristallader",
    "icon": "💎",
    "description": "Eine frei liegende Kristallader glitzerte im Fels.",
    "base_chance": 0.1,
    "affinity_bonus": {
      "erde": 0.03,
      "arkan": 0.02
    },
    "trait_bonus": {
      "schatzsucher": 0.06
    },
    "reward": {
      "crystals": 20
    },
    "sort_order": 2
  },
  {
    "id": "verlassene_ruine",
    "name": "Verlassene Ruine",
    "icon": "🏚️",
    "description": "In einer verfallenen Ruine lag eine vergessene Rune.",
    "base_chance": 0.07,
    "affinity_bonus": {
      "arkan": 0.03
    },
    "trait_bonus": {
      "forscher": 0.06
    },
    "reward": {
      "runes": 1
    },
    "sort_order": 3
  },
  {
    "id": "alter_schrein",
    "name": "Alter Schrein",
    "icon": "⛩️",
    "description": "Ein alter Schrein schenkte dem Team leuchtende Essenz.",
    "base_chance": 0.08,
    "affinity_bonus": {
      "licht": 0.04
    },
    "trait_bonus": {
      "forscher": 0.04
    },
    "reward": {
      "essence": 18
    },
    "sort_order": 4
  },
  {
    "id": "unbekannte_hoehle",
    "name": "Unbekannte Höhle",
    "icon": "🕳️",
    "description": "Eine unentdeckte Höhle voller Stein und Holzreste.",
    "base_chance": 0.1,
    "affinity_bonus": {
      "dunkel": 0.03,
      "erde": 0.02
    },
    "trait_bonus": {
      "entdecker": 0.04
    },
    "reward": {
      "stone": 250,
      "wood": 150
    },
    "sort_order": 5
  },
  {
    "id": "verlorene_lieferung",
    "name": "Verlorene Lieferung",
    "icon": "📦",
    "description": "Eine verlorene Händlerlieferung mit Futter für die Nester.",
    "base_chance": 0.1,
    "affinity_bonus": {
      "wind": 0.03
    },
    "trait_bonus": {
      "sammler": 0.08
    },
    "reward": {
      "fruit": 150,
      "meat": 150
    },
    "sort_order": 6
  },
  {
    "id": "wandernder_haendler",
    "name": "Wandernder Händler",
    "icon": "🧳",
    "description": "Ein wandernder Händler bezahlte für Begleitschutz.",
    "base_chance": 0.07,
    "affinity_bonus": {},
    "trait_bonus": {
      "gierig": 0.06
    },
    "reward": {
      "gold_units": 40,
      "crystals": 8
    },
    "sort_order": 7
  },
  {
    "id": "verletzter_drache",
    "name": "Verletzter Drache",
    "icon": "🩹",
    "description": "Das Team half einem verletzten wilden Drachen - das schweißt zusammen.",
    "base_chance": 0.06,
    "affinity_bonus": {
      "licht": 0.04,
      "wasser": 0.02
    },
    "trait_bonus": {
      "heiler": 0.1
    },
    "reward": {
      "bond_xp": 60,
      "essence": 8
    },
    "sort_order": 8
  },
  {
    "id": "geheimnisvolles_ei",
    "name": "Geheimnisvolles Ei",
    "icon": "🥚",
    "description": "In einem verlassenen Nest lag ein geheimnisvolles Ei.",
    "base_chance": 0.03,
    "affinity_bonus": {
      "arkan": 0.01
    },
    "trait_bonus": {
      "entdecker": 0.02
    },
    "reward": {
      "eggs": 1
    },
    "sort_order": 9
  }
];

function cloneExpeditionReferenceTables() {
  return {
    expedition_regions: JSON.parse(JSON.stringify(EXPEDITION_REGIONS)),
    expedition_missions: JSON.parse(JSON.stringify(EXPEDITION_MISSIONS)),
    expedition_events: JSON.parse(JSON.stringify(EXPEDITION_EVENTS))
  };
}

module.exports = { EXPEDITION_REGIONS, EXPEDITION_MISSIONS, EXPEDITION_EVENTS, cloneExpeditionReferenceTables };
