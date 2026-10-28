// Compara dos carpetas de PNG por nombre. Uso: node comparar-pngs.mjs <A> <B>
// Reporta, por imagen: tamaño, píxeles distintos, diferencia máxima por canal. Sale con 1 si alguna difiere en >2 niveles o en tamaño.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sharp = createRequire(path.join(raiz, 'package.json'))('sharp');
const [A, B] = process.argv.slice(2);
let mal = 0, n = 0, ident = 0;
for (const f of readdirSync(A).filter((x) => x.endsWith('.png')).sort()) {
  const a = await sharp(path.join(A, f)).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(path.join(B, f)).raw().toBuffer({ resolveWithObject: true });
  n++;
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) { console.log(`TAMAÑO ${f}`); mal++; continue; }
  let d = 0, mx = 0;
  for (let i = 0; i < a.data.length; i++) { const x = Math.abs(a.data[i] - b.data[i]); if (x) { d++; if (x > mx) mx = x; } }
  if (d === 0) ident++;
  if (mx > 2) { mal++; console.log(`DIFIERE ${f}: ${d} valores, máx ${mx}`); } else if (d) console.log(`ruido ${f}: ${d} valores, máx ${mx}`);
}
console.log(`${n} comparadas, ${ident} idénticas byte a byte, ${mal} con diferencia real (>2 niveles o de tamaño)`);
process.exit(mal ? 1 : 0);
