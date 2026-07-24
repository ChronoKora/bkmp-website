/* Statische Codeanalyse (QA-Grundlage Phase 2, 24.07.2026 - siehe CLAUDE.md).

   Bewusst KEINE Migration zu ES-Modulen/TypeScript - das Projekt laedt alle
   Dateien als klassische globale <script>-Tags mit fester Reihenfolge
   (CLAUDE.md "Architektur-Entscheidungen": ~418 globale Funktionen + 156
   geteilte veraenderliche Variablen ueber ~25 Dateien). Zwei Standardregeln
   sind deshalb ABSICHTLICH ausgeschaltet, nicht vergessen:

   - "no-undef": ESLint lint pro Datei, ohne die echte <script>-Ladereihenfolge
     zu kennen. Fast jede Datei referenziert Funktionen/Variablen, die in
     einer ANDEREN Datei deklariert sind (das IST die Architektur, siehe
     Modul-Karte) - mit no-undef waeren praktisch alle produktiven
     Cross-Datei-Aufrufe false positives. Eine manuell gepflegte Globals-Liste
     mit ~418 Eintraegen waere selbst eine staendige Fehlerquelle.
   - "no-unused-vars": aus demselben Grund - eine in Datei A deklarierte, nur
     von Datei B aufgerufene Funktion sieht fuer ESLint (pro Datei betrachtet)
     wie eine nie benutzte Deklaration aus.

   Fokus stattdessen auf echte, dateilokal erkennbare Fehlerklassen
   (eslint:recommended minus der beiden obigen) + die projektspezifische
   Pruefung in scripts/static-checks.js, die genau die Cross-Datei-Faelle
   abdeckt, die ESLint hier bewusst nicht pruefen kann (doppelte globale
   Funktionsnamen, Ladereihenfolge, Prod-URLs, etc.). */

const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'assets/vendor/**',
      'assets/**',
      'tests/report/**',
      'sql/**'
    ]
  },
  {
    files: ['**/*.js'],
    ignores: ['tests/**/*.js', 'scripts/**/*.js', 'api/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 2022,
      globals: {
        // Browser-Umgebung (window, document, fetch, localStorage, ...)
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', history: 'readonly', localStorage: 'readonly',
        sessionStorage: 'readonly', fetch: 'readonly', console: 'readonly',
        setTimeout: 'writable', clearTimeout: 'writable', setInterval: 'writable',
        clearInterval: 'writable', requestAnimationFrame: 'writable',
        cancelAnimationFrame: 'writable', URL: 'readonly', URLSearchParams: 'readonly',
        Promise: 'readonly', WebSocket: 'readonly', Image: 'readonly',
        FormData: 'readonly', File: 'readonly', Blob: 'readonly',
        FileReader: 'readonly', CustomEvent: 'readonly', Event: 'readonly',
        MutationObserver: 'readonly', ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly', performance: 'readonly',
        crypto: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
        getComputedStyle: 'readonly', matchMedia: 'readonly',
        HTMLElement: 'readonly', Node: 'readonly', Text: 'readonly',
        self: 'readonly', globalThis: 'readonly',
        // Alle Cross-Datei-Globalen des Projekts selbst - siehe no-undef-
        // Begruendung oben, hier absichtlich NICHT einzeln aufgezaehlt.
        module: 'readonly', require: 'readonly', process: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // Diese eine Ausnahme aus recommended zurueckgenommen: leere catch-
      // Bloecke sind im Projekt an vielen Stellen bewusst genutzt (z.B.
      // "Speicherversuch im Hintergrund, Fehler still ignorieren") - das
      // eigene static-checks.js zaehlt/meldet sie separat als eigene,
      // klar benannte Kategorie statt als generischen ESLint-Fehler.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // tests/**, scripts/** (lokale Node-Tools) UND api/** (Vercel-Serverless-
    // Functions, laufen server-seitig in Node, nicht im Browser) - ohne
    // diese eigene Node-Globals-Gruppe kollidierte z.B. "const crypto =
    // require('crypto')" in api/stripe-webhook.js mit dem browserseitigen
    // Web-Crypto-"crypto"-Global aus der Gruppe oben (no-redeclare
    // false positive, beim ersten echten Testlauf gefunden).
    files: ['tests/**/*.js', 'scripts/**/*.js', 'api/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'readonly', process: 'readonly',
        __dirname: 'readonly', console: 'readonly', Buffer: 'readonly',
        global: 'readonly', setTimeout: 'writable', clearTimeout: 'writable',
        setInterval: 'writable', clearInterval: 'writable'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Wiederkehrendes, absichtliches Playwright-Idiom in tests/e2e/*.spec.js:
      // `test.beforeEach(async ({}, testInfo) => {...})` braucht das leere
      // Objekt-Muster als ERSTEN Parameter, um ueberhaupt an testInfo (den
      // zweiten) zu kommen, obwohl keine Fixture destrukturiert wird - kein
      // Bug, an mehreren Stellen bewusst so genutzt (Mobil-Projekt-Skip-
      // Wachen, siehe CLAUDE.md Phase 2 QA-Ausbau).
      'no-empty-pattern': 'off'
    }
  }
];
