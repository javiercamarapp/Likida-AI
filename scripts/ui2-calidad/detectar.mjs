// Detector de calidad de la UI v2 de Likida (puerto de los detectores de Rovaq).
//   node scripts/ui2-calidad/detectar.mjs [--trabajo=DIR] [--out=DIR] [--etiqueta=v2-actual]
//        [--pantallas=c01,a1] [--anchos=1440,1024,768,390] [--temas=claro,oscuro] [--capturas] [--selftest]
// Lee el HTML que deja render.sh en TRABAJO, lo abre con Chromium (Playwright) en cada ancho × tema, ejecuta
// medir.mjs en la página y escribe:  $OUT/medidas.json (una entrada por pantalla × ancho × tema) y $OUT/informe.md.
// Sale con código 1 si hay hallazgos (compuerta); --selftest comprueba que cada criterio SÍ detecta y que una
// pantalla limpia da 0. Datos sintéticos; ningún nombre de cliente.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medir, UMBRALES } from './medir.mjs';
import { informe, CRITERIOS } from './informe.mjs';
import { PANTALLAS_TIPO } from './pantallas.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const { chromium } = require('playwright');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const TRABAJO = arg.trabajo ?? path.join(homedir(), 'likida-loop/frontend-plan/rovaq-method/.trabajo');
const OUT = arg.out ?? path.join(homedir(), 'likida-loop/frontend-plan/rovaq-method');
const ETIQUETA = arg.etiqueta ?? 'v2-actual';
const ANCHOS = String(arg.anchos ?? '1440,1024,768,390').split(',').map(Number);
const TEMAS = String(arg.temas ?? 'claro,oscuro').split(',');
const ALTO = { 1440: 900, 1024: 768, 768: 1024, 390: 844 };
const FUENTES = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');

const ff = (fam, w, f) => `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:block;src:url('file://${FUENTES}/${f}') format('woff2')}`;
const hayFuentes = existsSync(path.join(FUENTES, 'hankengrotesk-400.woff2'));
const FUENTES_CSS = hayFuentes ? [
  ...[400, 500, 600, 700].map((w) => ff('Hanken Grotesk UI', w, `hankengrotesk-${w}.woff2`)),
  ...[400, 500].map((w) => ff('IBM Plex Mono', w, `plexmono-${w}.woff2`)),
  `html{--font-mono:'IBM Plex Mono'}`,
  // lo que declara ui-v2/fonts.css (en producción lo importa el layout; aquí las rutas son de archivo):
  `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif;--font-display:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif}`,
].join('\n') : '';

const CONGELAR = '*,*::before,*::after{transition:none!important;animation:none!important}';
const docHtml = (cuerpo, cssRuta, extra = '') => `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${cssRuta ? `<link rel="stylesheet" href="file://${cssRuta}">` : ''}<style>${FUENTES_CSS}</style><style>${CONGELAR}</style>${extra}</head><body>${cuerpo}</body></html>`;

/** Descubre las pantallas renderizadas por render.sh. */
function descubrir() {
  const lista = [];
  const leer = (dir, grupo, filtro = () => true) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.html') && !n.endsWith('.doc.html') && filtro(n)).sort()) lista.push({ id: f.replace('.html', ''), grupo, archivo: path.join(dir, f) });
  };
  leer(path.join(TRABAJO, 'a/vistas'), 'a-muestrario');
  leer(path.join(TRABAJO, 'c/vistas'), 'c-paginas', (n) => /^c\d\d-/.test(n));
  leer(path.join(TRABAJO, 'c/vistas-c2'), 'c2-agentes');
  leer(path.join(TRABAJO, 'x/vistas'), 'x-carga');
  for (const p of lista) {
    p.css = path.join(TRABAJO, p.grupo.startsWith('a') ? 'a' : p.grupo.startsWith('x') ? 'x' : 'c', 'v2full.css');
    p.tipo = PANTALLAS_TIPO[p.id] ?? 'componentes';
  }
  return lista;
}

/** Ejecuta medir() dentro de la página (la función viaja como texto: es autocontenida). */
export const ejecutar = (page, opts) => page.evaluate(({ src, U, o }) => (0, eval)('(' + src + ')')(U, o), { src: medir.toString(), U: UMBRALES, o: opts });

async function medirPantalla(browser, p, cuerpo, cssRuta, w, tema, { pliegueAplica, carga }) {
  const h = ALTO[w] ?? 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'es-MX', isMobile: w < 500, hasTouch: w < 500 });
  const page = await ctx.newPage();
  const archivo = path.join(TRABAJO, `.doc-${p.id}.html`);
  writeFileSync(archivo, docHtml(cuerpo, cssRuta));
  await page.goto('file://' + archivo);
  await page.evaluate(async (t) => { document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'); await document.fonts.ready; }, tema);
  await page.waitForTimeout(60);
  const res = await ejecutar(page, { pliegue: pliegueAplica, carga });
  if (arg.capturas) {
    const dir = path.join(OUT, 'capturas-' + ETIQUETA); mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${p.id}__${w}__${tema}.png`), fullPage: false });
  }
  await ctx.close();
  return res;
}

async function correr() {
  const pantallas = descubrir().filter((p) => !arg.pantallas || String(arg.pantallas).split(',').some((s) => p.id.startsWith(s)));
  if (!pantallas.length) { console.error('Sin pantallas en ' + TRABAJO + ': corre scripts/ui2-calidad/render.sh primero.'); process.exit(2); }
  const browser = await chromium.launch();
  const salida = { meta: { etiqueta: ETIQUETA, fecha: new Date().toISOString(), anchos: ANCHOS, temas: TEMAS, umbrales: UMBRALES, fuentesHanken: hayFuentes, pantallas: pantallas.map((p) => ({ id: p.id, grupo: p.grupo, tipo: p.tipo })) }, pantallas: {} };
  for (const p of pantallas) {
    const cuerpo = readFileSync(p.archivo, 'utf8');
    salida.pantallas[p.id] = { grupo: p.grupo, tipo: p.tipo, combinaciones: {} };
    for (const w of ANCHOS) for (const tema of TEMAS) {
      const carga = p.grupo === 'x-carga';
      const pliegueAplica = w === 1440 && p.tipo === 'panel' && !carga;
      let res;
      try { res = await medirPantalla(browser, p, cuerpo, p.css, w, tema, { pliegueAplica, carga }); }
      catch (e) { res = { n: { error: 1 }, hallazgos: { error: [String(e.message).slice(0, 200)] }, stats: {} }; }
      // En la pantalla de carga solo cuenta c8 (el resto mide el marco, no la carga).
      for (const k of Object.keys(res.n)) if (carga !== k.startsWith('c8.') && k !== 'error') { delete res.n[k]; delete res.hallazgos[k]; }
      salida.pantallas[p.id].combinaciones[`${w}/${tema}`] = { n: res.n, hallazgos: res.hallazgos, stats: res.stats };
      process.stdout.write('.');
    }
  }
  await browser.close();
  console.log();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, arg.json ?? `medidas-${ETIQUETA}.json`), JSON.stringify(salida, null, 1));
  const md = informe(salida);
  writeFileSync(path.join(OUT, arg.md ?? `INFORME-${ETIQUETA}.md`), md);
  const total = Object.values(salida.pantallas).reduce((a, p) => a + Object.values(p.combinaciones).reduce((b, c) => b + Object.values(c.n).reduce((x, y) => x + y, 0), 0), 0);
  console.log(`${pantallas.length} pantallas × ${ANCHOS.length} anchos × ${TEMAS.length} temas; ${total} hallazgos (suma de combinaciones)`);
  return total;
}

if (arg.selftest) {
  const { selftest } = await import('./selftest.mjs');
  const ok = await selftest({ chromium, docHtml, ejecutar, CRITERIOS, ALTO });
  process.exit(ok ? 0 : 1);
}
const total = await correr();
process.exit(total ? 1 : 0);
