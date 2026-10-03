// Regenera los fixtures HTML SINTÉTICOS de los guiones de portal (uno por guion, derivado de su tabla de selectores).
//   npx tsx scripts/generar-fixtures-portales.ts
// Un fixture `grabado` (DOM real saneado, escrito por scripts/verificar-portal.mjs) NO se pisa. Ver
// src/lib/likida/autofactura/fixtures_portal.ts para lo que estos fixtures prueban y lo que no.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIONES } from '@/lib/likida/facturacion/adaptadores/portales';
import { construirFixture } from '@/lib/likida/autofactura/fixtures_portal';
import { huellaDeGuion } from '@/lib/likida/autofactura/verificacion';

const RAIZ = join(process.cwd(), 'src/lib/likida/facturacion/adaptadores/fixtures');
mkdirSync(RAIZ, { recursive: true });
const manifiestoRuta = join(RAIZ, 'manifest.json');
// Se lee directo y se distingue «no existe» por el código del error: `existsSync` + lectura abría una
// ventana entre la comprobación y el uso (CodeQL js/file-system-race).
function leerManifiestoPrevio(): Record<string, { origen: string }> {
  try {
    return JSON.parse(readFileSync(manifiestoRuta, 'utf8')).portales ?? {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}
const previo = leerManifiestoPrevio();
const portales: Record<string, unknown> = {};

for (const g of GUIONES) {
  if (previo[g.comercio]?.origen === 'grabado') { portales[g.comercio] = previo[g.comercio]; continue; }
  const f = construirFixture(g);
  const dir = join(RAIZ, g.comercio);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'formulario.html'), f.formulario, 'utf8');
  writeFileSync(join(dir, 'rechazo.html'), f.rechazo, 'utf8');
  portales[g.comercio] = { origen: 'sintetico_desde_guion', huellaGuion: huellaDeGuion(g), noSintetizable: f.noSintetizable };
}
writeFileSync(manifiestoRuta, `${JSON.stringify({
  _nota: 'origen sintetico_desde_guion = derivado de los selectores del guion (NO prueba nada del portal real); grabado = DOM real saneado por una corrida supervisada.',
  portales,
}, null, 2)}\n`, 'utf8');
console.log(`fixtures escritos para ${GUIONES.length} guiones en ${RAIZ}`);
const malos = Object.entries(portales).filter(([, v]) => (v as { noSintetizable?: string[] }).noSintetizable?.length);
for (const [k, v] of malos) console.log(`  ⚠ ${k}: no sintetizable → ${(v as { noSintetizable: string[] }).noSintetizable.join(' ; ')}`);
