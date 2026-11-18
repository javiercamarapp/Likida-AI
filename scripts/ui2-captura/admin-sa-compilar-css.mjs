// Compila el CSS REAL de /admin (lo que importa admin/layout.tsx + los .css de las páginas) con Tailwind 4.
// Uso: node scripts/ui2-captura/admin-sa-compilar-css.mjs [OUT]   ->  $OUT/admin.css
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const OUT = process.argv[2] ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes-admin-sa');

// Mismo orden que admin/layout.tsx (fonts.css se omite: apunta a /fonts, la pone el capturador con rutas de archivo).
const LAYOUT = ['ui-v2/tokens.css', 'ui-v2/shell.css', 'admin/admin-shell.css', 'ui-v2/pie-sidebar.css', 'ui-v2/componentes.css', 'ui-v2/overlay.css',
  'ui-v2/piezas.css', 'ui-v2/barra-periodo.css', 'ui-v2/graficas.css', 'ui-v2/datos.css', 'ui-v2/movimiento.css', 'ui-v2/paginas.css',
  'ui-v2/paginas-dominio.css', 'ui-v2/carga.css'];
const todos = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? todos(p) : p.endsWith('.css') ? [p] : []; });
const rel = (p) => path.relative(path.join(raiz, 'src/app'), p);
const paginas = todos(path.join(raiz, 'src/app/admin')).map(rel).filter((p) => !LAYOUT.includes(p)).sort();
const extra = ['ui-v2/avisos/avisos.css', 'ui-v2/componentes/fila-tarjetas.css', 'ui-v2/componentes/lista-fuentes.css', 'ui-v2/esqueletos/esqueletos.css', 'ui-v2/icono-agente.css', 'dashboard/chat/chat-pagina.css', 'ui-v2/chat.css'];

const globals = readFileSync(path.join(raiz, 'src/app/globals.css'), 'utf8');
if (!globals.includes('@import "tailwindcss";')) throw new Error('globals.css cambió');
const base = globals.replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source "${raiz}/src/app/admin";\n@source "${raiz}/src/app/ui-v2";\n@source "${raiz}/src/app/dashboard/shell";`);
const imports = [...LAYOUT, ...extra, ...paginas].map((p) => `@import "./${p}";`).join('\n');
const entrada = path.join(raiz, 'src/app', '.arnes-admin-sa.css'); // temporal junto a globals para resolver imports
const css = `${base}\n${imports}\n`;
writeFileSync(entrada, css);
try {
  const r = await postcss([tailwind({ base: raiz })]).process(css, { from: entrada });
  writeFileSync(path.join(OUT, 'admin.css'), r.css);
  console.log('admin.css', (r.css.length / 1024).toFixed(0), 'KB;', LAYOUT.length + extra.length + paginas.length, 'hojas');
} finally { unlinkSync(entrada); }
