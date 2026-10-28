// Compila el CSS REAL (globals.css con Tailwind 4) para el arnés de capturas.
// Uso: node scripts/ui2-captura/compilar-css.mjs [OUT]
// Salida: $OUT/v1.css (globals.css solo) y $OUT/v2.css (globals.css + ui-v2/tokens.css,
// que es como lo cargará dashboard/layout.tsx). Tailwind escanea SOLO $OUT/vistas.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const OUT = process.argv[2] ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes');

const globals = readFileSync(path.join(raiz, 'src/app/globals.css'), 'utf8');
if (!globals.includes('@import "tailwindcss";')) throw new Error('globals.css cambió: ya no empieza con @import "tailwindcss"');
const base = globals.replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source "${OUT}/vistas";`);

async function compilar(nombre, css) {
  const entrada = path.join(raiz, 'src/app', `.arnes-${nombre}.css`); // temporal junto a globals para resolver imports
  writeFileSync(entrada, css);
  try {
    const r = await postcss([tailwind({ base: raiz })]).process(css, { from: entrada });
    writeFileSync(path.join(OUT, `${nombre}.css`), r.css);
    console.log(nombre, (r.css.length / 1024).toFixed(0), 'KB');
  } finally {
    (await import('node:fs')).unlinkSync(entrada);
  }
}
await compilar('v1', base);
await compilar('v2', `${base}\n@import "./ui-v2/tokens.css";\n`);
