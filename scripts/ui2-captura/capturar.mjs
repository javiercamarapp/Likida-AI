// Captura las vistas renderizadas por el arnés. Uso:
//   node scripts/ui2-captura/capturar.mjs --modo=v1|v1-tokens|v2 [--fuente=inter|hanken|sistema] --dest=DIR [--out=OUT] [--vistas=a,b]
// Anchos 1440x900, 1024x768, 412x915 × claro/oscuro. Chromium headless con movimiento reducido.
// v1        = CSS sin tokens.css, sin data-ui  (línea base)
// v1-tokens = CSS CON tokens.css, sin data-ui  (invariancia: debe ser idéntico a v1)
// v2        = CSS con tokens.css y data-ui="v2" puesto sobre el div .tema-neutro (lo que hará dashboard/layout.tsx)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const { chromium } = require('playwright');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = arg.out ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes');
const modo = arg.modo ?? 'v1';
const fuente = arg.fuente ?? 'inter';
const dest = arg.dest ?? path.join(OUT, 'capturas', `${modo}-${fuente}`);
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');
const ff = (fam, w, f) => `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/${f}') format('woff2')}`;
const fuentesCss = [
  ...[400, 500, 600, 700].map((w) => ff('Inter', w, `inter-${w}.woff2`)),
  ...[500, 600, 700].map((w) => ff('Inter Tight', w, `intertight-${w}.woff2`)),
  ...[400, 500].map((w) => ff('IBM Plex Mono', w, `plexmono-${w}.woff2`)),
  ...[400, 500, 600, 700].map((w) => ff('Hanken Grotesk', w, `hankengrotesk-${w}.woff2`)),
  // Lo que next/font deja en <html> en producción:
  `html{--font-sans-ui:'Inter';--font-display:'Inter Tight';--font-mono:'IBM Plex Mono'}`,
  // Decisión D-5 (una sola variable, bajo el alcance v2):
  fuente === 'hanken' ? `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk';--font-display:'Hanken Grotesk'}` : '',
  fuente === 'sistema' ? `[data-ui="v2"]{--font-sans-ui:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui;--font-display:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui}` : '',
].join('\n');
writeFileSync(path.join(OUT, 'fuentes.css'), fuentesCss);

const css = arg.css ? `${arg.css}.css` : modo === 'v1' ? 'v1.css' : 'v2.css'; // --css=v2full: CSS completo del chrome v2
const vistas = readdirSync(path.join(OUT, 'vistas')).filter((f) => f.endsWith('.html') && !f.endsWith('.doc.html')).map((f) => f.replace('.html', '')).filter((v) => !arg.vistas || arg.vistas.split(',').some((s) => v.startsWith(s)));
// --anchos=1440x900,390x844 sustituye los anchos por omisión
const ANCHOS = arg.anchos ? arg.anchos.split(',').map((a) => a.split('x').map(Number)) : [[1440, 900], [1024, 768], [412, 915]];
const TEMAS = ['claro', 'oscuro'];
mkdirSync(dest, { recursive: true });

const cssTexto = readFileSync(path.join(OUT, css), 'utf8') + '\n' + readFileSync(path.join(OUT, 'fuentes.css'), 'utf8');
// --sin-carga: el HTML es estático (no corre el controlador que suelta la capa de carga): se marca como liberada para ver el marco.
const armarDoc = (cuerpo) => `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><style>${cssTexto}</style></head><body>${arg['sin-carga'] ? cuerpo.replace(' data-estado="inicial"', ' data-estado="oculta"') : cuerpo}</body></html>`;

const browser = await chromium.launch();
let n = 0;
for (const [w, h] of ANCHOS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'es-MX' });
  const page = await ctx.newPage();
  for (const v of vistas) {
    const doc = armarDoc(readFileSync(path.join(OUT, 'vistas', `${v}.html`), 'utf8'));
    const archivo = path.join(OUT, 'vistas', `${v}.doc.html`);
    writeFileSync(archivo, doc);
    for (const tema of TEMAS) {
      await page.goto('file://' + archivo);
      await page.evaluate(async ([t, m]) => {
        document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark');
        if (m === 'v2') document.querySelector('.tema-neutro').setAttribute('data-ui', 'v2');
        await document.fonts.ready;
      }, [tema, modo]);
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(dest, `${v}__${w}__${tema}.png`) });
      n++;
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`${n} capturas -> ${dest}`);

function join(OUTDIR, v, cssFile) {
  const cuerpo = readFileSync(path.join(OUTDIR, 'vistas', `${v}.html`), 'utf8');
  return `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${OUTDIR}/${cssFile}"><link rel="stylesheet" href="file://${OUTDIR}/fuentes.css"><style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head><body>${cuerpo}</body></html>`;
}
