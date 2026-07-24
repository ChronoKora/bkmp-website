#!/usr/bin/env node
/* Projektspezifische statische Pruefung (QA-Grundlage Phase 2, 24.07.2026 -
   siehe CLAUDE.md). Ergaenzt ESLint (eslint.config.js) um genau die
   Cross-Datei-Faelle, die ESLint pro-Datei-Analyse strukturell nicht sehen
   kann (doppelte globale Funktionsnamen zwischen Dateien, Skript-
   Ladereihenfolge, fehlende/doppelte <script>-Einbindungen, verwaiste
   data-testid-Selektoren). Regex-/String-basiert, kein AST-Parser - bewusst
   einfach gehalten (kein neuer Bundler/Parser-Abhaengigkeit), Heuristiken
   sind als solche gekennzeichnet.

   Ausgabe nach Schweregrad sortiert: CRITICAL > HIGH > MEDIUM > LOW > INFO.
   Exit-Code 1 nur bei CRITICAL/HIGH-Funden (fuer CI-taugliche Nutzung ueber
   npm run qa:static), MEDIUM/LOW/INFO sind rein informativ. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const CLIENT_JS_FILES = [
  'app.js', 'idledorf.js', 'mapart.js', 'supabase.js', 'sw.js',
  'js/core/bkmp-app-mode-bootstrap.js', 'js/core/bkmp-combat-math.js',
  'js/core/bkmp-game-clock.js', 'js/core/bkmp-idle-bootstrap.js',
  'js/core/bkmp-idle-state.js', 'js/core/bkmp-site.js',
  'js/dev/bkmp-qa-panel.js', 'js/prototype/bkmp-proto-compact-hud.js',
  'js/systems/bkmp-achievements.js', 'js/systems/bkmp-arena.js',
  'js/systems/bkmp-breeding.js', 'js/systems/bkmp-cosmetics.js',
  'js/systems/bkmp-dungeon.js', 'js/systems/bkmp-events.js',
  'js/systems/bkmp-guild.js', 'js/systems/bkmp-leaderboard.js',
  'js/systems/bkmp-meister.js', 'js/systems/bkmp-prestige.js',
  'js/systems/bkmp-raid.js', 'js/systems/bkmp-runes.js',
  'js/systems/bkmp-skilltree.js', 'js/systems/bkmp-tower.js',
  'js/ui/bkmp-feedback-board.js', 'js/ui/bkmp-hud.js',
  'js/ui/bkmp-reward-presenter.js', 'js/ui/bkmp-ui-components.js'
].filter(f => fs.existsSync(path.join(ROOT, f)));

const HTML_FILES = ['index.html', 'admin.html', 'idle-stream-mini.html', 'datenschutz.html', 'impressum.html']
  .filter(f => fs.existsSync(path.join(ROOT, f)));

const findings = []; // { severity, category, file, line, message }
function report(severity, category, file, line, message) {
  findings.push({ severity, category, file, line: line || '', message });
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------- 1. Doppelte globale Funktions-/Variablennamen zwischen Dateien ----------
// Heuristik: Top-Level (kein fuehrendes Leerzeichen) "function NAME(" und
// "const/let/var NAME =" - passt zum durchgaengigen Formatierungsstil dieses
// Projekts (verifiziert stichprobenartig beim Lesen mehrerer Systemdateien).
{
  const declaredBy = new Map(); // name -> [{file, line}]
  const fnRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const varRe = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
  CLIENT_JS_FILES.forEach(file => {
    const lines = readFile(file).split('\n');
    lines.forEach((line, idx) => {
      const fm = fnRe.exec(line);
      const vm = varRe.exec(line);
      const name = (fm && fm[1]) || (vm && vm[1]);
      if (!name) return;
      if (!declaredBy.has(name)) declaredBy.set(name, []);
      declaredBy.get(name).push({ file, line: idx + 1 });
    });
  });
  declaredBy.forEach((occurrences, name) => {
    if (occurrences.length > 1) {
      const files = occurrences.map(o => `${o.file}:${o.line}`).join(', ');
      report('HIGH', 'doppelte-globale-deklaration', occurrences[0].file, occurrences[0].line,
        `"${name}" top-level in mehreren Dateien deklariert (letzte geladene Datei gewinnt, still): ${files}`);
    }
  });
}

// ---------- 2. Direkte Produktions-Supabase-URL ausserhalb der erlaubten Dateien ----------
{
  const PROD_URL = 'zgknyrwzpohvfdweomxf.supabase.co';
  const ALLOWED = new Set(['supabase.js']); // api/*.js sind separat erlaubt (server-seitig, eigener SUPABASE_URL)
  CLIENT_JS_FILES.forEach(file => {
    if (ALLOWED.has(file)) return;
    const lines = readFile(file).split('\n');
    lines.forEach((line, idx) => {
      if (line.includes(PROD_URL)) {
        report('MEDIUM', 'prod-url-referenz', file, idx + 1, `Produktions-Host-String ausserhalb supabase.js: "${line.trim().slice(0, 100)}"`);
      }
    });
  });
  // Nur index.html kann ueberhaupt in den QA-Modus wechseln (window.BKMP_QA_MODE
  // wird ausschliesslich dort gesetzt, siehe CLAUDE.md) - ein unconditional
  // preconnect auf admin.html/idle-stream-mini.html ist dort strukturell nie
  // ein QA-Kontakt-Problem und wird deshalb bewusst NICHT gemeldet.
  const html = readFile('index.html');
  html.split('\n').forEach((line, idx) => {
    if (line.includes(PROD_URL) && /<link[^>]*rel="preconnect"/.test(line)) {
      report('MEDIUM', 'prod-preconnect-ungegated', 'index.html', idx + 1,
        `<link rel="preconnect"> zur Produktions-Domain ist NICHT an window.BKMP_QA_MODE gekoppelt - im QA-Modus dennoch ein (datenloser) Netzwerkkontakt: "${line.trim()}"`);
    }
  });
}

// ---------- 3. eval / new Function ----------
{
  CLIENT_JS_FILES.forEach(file => {
    const lines = readFile(file).split('\n');
    lines.forEach((line, idx) => {
      if (/\beval\s*\(/.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        report('CRITICAL', 'eval-verwendet', file, idx + 1, line.trim().slice(0, 100));
      }
      if (/new\s+Function\s*\(/.test(line)) {
        report('CRITICAL', 'new-function-verwendet', file, idx + 1, line.trim().slice(0, 100));
      }
    });
  });
}

// ---------- 4. innerHTML mit dynamischen Daten (grobe Heuristik: Template-Literal mit ${}) ----------
{
  CLIENT_JS_FILES.forEach(file => {
    const lines = readFile(file).split('\n');
    lines.forEach((line, idx) => {
      if (/\.innerHTML\s*=\s*`[^`]*\$\{/.test(line)) {
        report('LOW', 'innerhtml-dynamisch', file, idx + 1,
          'innerHTML mit interpolierten Werten - nur relevant, falls einer der Werte ungefilterter Nutzer-Text ist (siehe escapeHtml-Verwendung pruefen)');
      }
    });
  });
}

// ---------- 5. setInterval ohne erkennbares clearInterval im selben Scope-Bereich (Heuristik) ----------
{
  CLIENT_JS_FILES.forEach(file => {
    const content = readFile(file);
    const intervalMatches = [...content.matchAll(/(\w+)\s*=\s*(?:window\.)?setInterval\(/g)];
    intervalMatches.forEach(m => {
      const varName = m[1];
      const hasClear = new RegExp(`clearInterval\\(\\s*${varName}\\b`).test(content);
      if (!hasClear) {
        const line = content.slice(0, m.index).split('\n').length;
        report('MEDIUM', 'setinterval-ohne-clear', file, line,
          `setInterval einer Variable "${varName}" zugewiesen, aber kein "clearInterval(${varName})" im selben File gefunden (evtl. absichtlich dauerhaft, oder Cleanup in anderer Datei - manuell pruefen)`);
      }
    });
  });
}

// ---------- 6. Leere catch-Bloecke (informativ - im Projekt oft bewusst) ----------
{
  let emptyCatchCount = 0;
  CLIENT_JS_FILES.forEach(file => {
    const content = readFile(file);
    const matches = content.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || [];
    emptyCatchCount += matches.length;
  });
  report('INFO', 'leere-catch-bloecke', '(projektweit)', '', `${emptyCatchCount} leere catch-Bloecke gefunden (im Projekt an vielen Stellen bewusst genutztes Muster fuer "Speichern im Hintergrund, Fehler egal" - siehe CLAUDE.md-Kommentare an mehreren Stellen; nicht einzeln aufgelistet)`);
}

// ---------- 7. Promise-Aufrufe ohne erkennbare Fehlerbehandlung (grobe Heuristik) ----------
// Nur .then( ohne folgendes .catch( in derselben Kette UND kein umschliessendes try - stark
// heuristisch, viele false negatives moeglich (await in try/catch wird nicht separat erkannt,
// da das bereits durch die Sprache selbst abgesichert ist). Dient als grober INFO-Hinweis.
{
  CLIENT_JS_FILES.forEach(file => {
    const lines = readFile(file).split('\n');
    lines.forEach((line, idx) => {
      if (/\.then\s*\(/.test(line) && !/\.catch\s*\(/.test(line)) {
        const nextLines = lines.slice(idx, idx + 3).join('\n');
        if (!/\.catch\s*\(/.test(nextLines)) {
          report('LOW', 'then-ohne-catch-heuristik', file, idx + 1, line.trim().slice(0, 100));
        }
      }
    });
  });
}

// ---------- 8. HTML <script src="..."> - fehlende Dateien / doppelte Einbindung ----------
{
  HTML_FILES.forEach(file => {
    const content = readFile(file);
    const srcMatches = [...content.matchAll(/<script\s+src="([^"]+)"/g)];
    const seen = new Map();
    srcMatches.forEach(m => {
      const rawSrc = m[1].split('?')[0];
      if (/^https?:\/\//.test(rawSrc)) return; // externe Vendor-URLs ausserhalb des Scopes
      const filePath = path.join(ROOT, rawSrc);
      if (!fs.existsSync(filePath)) {
        const line = content.slice(0, m.index).split('\n').length;
        report('CRITICAL', 'fehlende-script-datei', file, line, `<script src="${m[1]}"> verweist auf nicht existierende Datei`);
      }
      seen.set(rawSrc, (seen.get(rawSrc) || 0) + 1);
    });
    seen.forEach((count, src) => {
      if (count > 1) report('HIGH', 'doppelte-script-einbindung', file, '', `"${src}" wird ${count}x eingebunden`);
    });
  });
}

// ---------- 9. Verwaiste data-testid-Selektoren (in Tests referenziert, im Quellcode nicht gefunden) ----------
{
  const testFiles = fs.existsSync(path.join(ROOT, 'tests/e2e'))
    ? fs.readdirSync(path.join(ROOT, 'tests/e2e')).filter(f => f.endsWith('.spec.js'))
    : [];
  const usedTestIds = new Set();
  testFiles.forEach(f => {
    const content = fs.readFileSync(path.join(ROOT, 'tests/e2e', f), 'utf8');
    [...content.matchAll(/data-testid=["']([^"']+)["']/g)].forEach(m => usedTestIds.add(m[1]));
  });
  const sourceCorpus = HTML_FILES.map(readFile).join('\n') + CLIENT_JS_FILES.map(readFile).join('\n');
  usedTestIds.forEach(id => {
    if (!sourceCorpus.includes(`data-testid="${id}"`) && !sourceCorpus.includes(`data-testid: '${id}'`) && !sourceCorpus.includes(`'${id}'`)) {
      report('HIGH', 'verwaister-data-testid', '(tests/e2e)', '', `data-testid="${id}" wird in Tests referenziert, aber in keiner HTML-/JS-Quelldatei gefunden`);
    }
  });
}

// ---------- Ausgabe ----------
const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);

let hasBlocking = false;
console.log('=== Projektspezifische statische Pruefung ===\n');
findings.forEach(f => {
  if (f.severity === 'CRITICAL' || f.severity === 'HIGH') hasBlocking = true;
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  console.log(`[${f.severity}] (${f.category}) ${loc}\n  ${f.message}\n`);
});
console.log(`Gesamt: ${findings.length} Funde (${findings.filter(f => f.severity === 'CRITICAL').length} CRITICAL, ${findings.filter(f => f.severity === 'HIGH').length} HIGH, ${findings.filter(f => f.severity === 'MEDIUM').length} MEDIUM, ${findings.filter(f => f.severity === 'LOW').length} LOW, ${findings.filter(f => f.severity === 'INFO').length} INFO)`);

process.exit(hasBlocking ? 1 : 0);
