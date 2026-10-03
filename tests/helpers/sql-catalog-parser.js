/* Liest die "insert into ... values (...), (...) on conflict"-Bloecke einer
   Migrationsdatei, damit Tests pruefen koennen, dass die Testdaten-Kataloge
   (tests/fixtures/*-reference.js) exakt der echten SQL entsprechen. */
const fs = require('fs');

function splitTuples(txt) {
  const out = []; let depth = 0, cur = '', inStr = false;
  for (let k = 0; k < txt.length; k++) {
    const c = txt[k];
    if (c === "'") { if (inStr && txt[k + 1] === "'") { cur += c + c; k++; continue; } inStr = !inStr; }
    if (!inStr && c === '(') { depth++; if (depth === 1) { cur = ''; continue; } }
    if (!inStr && c === ')') { depth--; if (depth === 0) { out.push(cur); continue; } }
    if (depth >= 1) cur += c;
  }
  return out;
}
function splitFields(t) {
  /* Kommas innerhalb von array[...] / (...) trennen keine Felder. */
  const out = []; let cur = '', inStr = false, depth = 0;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === "'") {
      if (inStr && t[k + 1] === "'") { cur += "'"; k++; continue; }
      inStr = !inStr;
      if (depth > 0) cur += c;
      continue;
    }
    if (!inStr && (c === '[' || c === '(')) depth++;
    if (!inStr && (c === ']' || c === ')')) depth--;
    if (!inStr && depth === 0 && c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
/* Liefert die Werte-Tupel (als Feld-Arrays, Text ohne Anfuehrungszeichen) des
   ersten "insert into public.<table>"-Blocks. */
function readInsertTuples(sqlPath, table) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const i = sql.indexOf('insert into public.' + table);
  if (i === -1) throw new Error('Kein Insert fuer ' + table);
  const j = sql.indexOf('on conflict', i);
  const block = sql.slice(i, j);
  return splitTuples(block.slice(block.indexOf('values'))).map(splitFields);
}

module.exports = { readInsertTuples };
