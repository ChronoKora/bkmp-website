/* ============================================================
   Bkmp - Pluschie-Ordner scannen

   Der Browser kann den Server-Dateisystem-Ordner assets/plushies/ nicht
   selbst auslesen (keine Dateisystem-API im Client) - diese kleine
   Funktion liest die Bilddateien serverseitig und liefert daraus
   abgeleitete Pluschie-Kandidaten (id/name/image) zurueck.

   Schreibt NICHTS in die Datenbank - das macht das Admin-Panel danach
   selbst ueber den eigenen (eingeloggten) Supabase-Client, der durch die
   normale RLS-Policy (nur Admins duerfen in "plushies" einfuegen)
   abgesichert ist. Diese Funktion braucht also keinen Service-Role-Key
   und liest nur oeffentliche Bild-Dateinamen, die sowieso ueber
   /assets/plushies/... abrufbar sind.
   ============================================================ */

const fs = require('fs');
const path = require('path');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function bkmpTitleCaseFromFilename(base) {
  const cleaned = base
    .replace(/[_-]?plushie$/i, '')
    .replace(/[_\-]+/g, ' ')
    .trim();
  const name = cleaned
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return name || base;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  const folder = path.join(process.cwd(), 'assets', 'plushies');
  let files = [];
  try {
    files = fs.readdirSync(folder);
  } catch (e) {
    return send(res, 500, { error: 'folder_read_failed', detail: String(e && e.message || e).slice(0, 300) });
  }

  const imageFiles = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
  const candidates = imageFiles.map(file => {
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    const id = base.toLowerCase().replace(/[_-]?plushie$/i, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || base.toLowerCase();
    const name = `${bkmpTitleCaseFromFilename(base)} Plüshie`;
    return { id, name, image: `assets/plushies/${file}` };
  });

  return send(res, 200, { ok: true, candidates });
};
