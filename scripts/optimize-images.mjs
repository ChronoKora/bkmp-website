// Bkmp - Redesign Phase 1 (17.07.): Bild-Optimierung fuer Spiel-Assets.
// Verkleinert PNGs auf die tatsaechlich benoetigte Anzeigegroesse (2x fuer
// Retina) und erzeugt daneben eine WebP-Variante, exakt nach dem Muster, das
// fuer die beiden Hero-Banner (top-banner.webp / idle-dorf-banner.webp)
// bereits funktioniert: <picture><source type="image/webp">+PNG-Fallback.
// Das Original-PNG bleibt als hochaufgeloeste Quelle unangetastet liegen,
// verkleinerte PNG + WebP landen mit "-web"-Suffix daneben - so kann dieses
// Skript jederzeit erneut ueber einen Ordner laufen, ohne die Quelle zu
// verlieren, falls spaeter eine noch groessere Anzeigeflaeche gebraucht wird.
//
// Braucht "sharp" (nicht Teil des Projekts/Deploys, nur ein einmaliges
// Autoren-Werkzeug): einmalig lokal installieren, z.B.
//   npm install sharp --no-save --prefix <irgendein-temp-ordner-ausserhalb-des-repos>
// und beim Aufruf NODE_PATH auf dessen node_modules zeigen lassen, z.B.
//   NODE_PATH=<temp-ordner>/node_modules node scripts/optimize-images.mjs <ordner> <maxDimension>
//
// Beispiel (Drachen-Zucht-Sprites, angezeigt bei max. 160px CSS-Pixeln,
// siehe .idle-dragon-dex-img in style.css -> 480px Zielgroesse deckt 3x
// Retina-Displays ab):
//   node scripts/optimize-images.mjs assets/dragons/breeding 480

import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import sharp from 'sharp';

const [, , targetDirArg, maxDimArg] = process.argv;
if (!targetDirArg) {
  console.error('Nutzung: node scripts/optimize-images.mjs <ordner> [maxDimension=480] [webpQuality=82]');
  process.exit(1);
}
const maxDim = Number(maxDimArg) || 480;
const webpQuality = Number(process.argv[4]) || 82;

function findPngFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findPngFiles(full));
    } else if (extname(entry).toLowerCase() === '.png' && !entry.includes('-web')) {
      out.push(full);
    }
  }
  return out;
}

const files = findPngFiles(targetDirArg);
console.log(`${files.length} PNG-Dateien gefunden unter ${targetDirArg}, Ziel: max ${maxDim}px, WebP-Qualitaet ${webpQuality}`);

let totalBefore = 0;
let totalAfterWebp = 0;
let totalAfterPng = 0;

for (const file of files) {
  const before = statSync(file).size;
  const dir = file.slice(0, file.length - basename(file).length);
  const nameNoExt = basename(file, '.png');
  const webpOut = join(dir, `${nameNoExt}-web.webp`);
  const pngOut = join(dir, `${nameNoExt}-web.png`);

  const pipeline = sharp(file).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });

  await pipeline.clone().webp({ quality: webpQuality }).toFile(webpOut);
  await pipeline.clone().png({ compressionLevel: 9, palette: true }).toFile(pngOut);

  const afterWebp = statSync(webpOut).size;
  const afterPng = statSync(pngOut).size;
  totalBefore += before;
  totalAfterWebp += afterWebp;
  totalAfterPng += afterPng;

  console.log(
    `${file}: ${(before / 1024).toFixed(0)}KB -> webp ${(afterWebp / 1024).toFixed(0)}KB, png-fallback ${(afterPng / 1024).toFixed(0)}KB`
  );
}

console.log('---');
console.log(`Gesamt vorher: ${(totalBefore / 1024 / 1024).toFixed(1)}MB`);
console.log(`Gesamt WebP:   ${(totalAfterWebp / 1024 / 1024).toFixed(1)}MB`);
console.log(`Gesamt PNG-Fallback: ${(totalAfterPng / 1024 / 1024).toFixed(1)}MB`);
