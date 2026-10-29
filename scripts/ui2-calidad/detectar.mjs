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
import { PANTALLAS_TIPO, PANTALLAS_RUTA, TIPOS_CON_PLIEGUE } from './pantallas.mjs';
import { duracionesCss, duracionesInline } from './duraciones.mjs';

// Todo lo pesado (Chromium) corre bajo ~/likida-loop/heavy.sh (un proceso pesado a la vez). Sin el candado, el detector se
// relanza a sí mismo bajo heavy.sh; HEAVY_ADENTRO lo marca para no relanzar en bucle.
const { spawnSync, execFileSync } = await import('node:child_process');
// Si CUALQUIER ancestro es heavy.sh (alguien lo envolvió a mano, también con npm / sh -c entre medio) no se relanza: el candado no
// es reentrante y el detector se bloquearía solo hasta el timeout de 30 min.
const bajoHeavy = (() => {
  try {
    let pid = process.ppid;
    for (let n = 0; n < 12 && pid > 1; n++) {
      const [ppid, ...cmd] = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
      if (/heavy\.sh/.test(cmd.join(' '))) return true;
      pid = Number(ppid);
    }
  } catch { /* sin ps: se asume que no hay candado y se relanza */ }
  return false;
})();
if (!process.env.HEAVY_ADENTRO && !process.env.UI2_SIN_HEAVY && !bajoHeavy) {
  const { homedir: casa } = await import('node:os');
  const r = spawnSync(path.join(casa(), 'likida-loop/heavy.sh'), [process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, HEAVY_ADENTRO: '1' } });
  process.exit(r.status ?? 1);
}
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const { chromium } = require('playwright');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const TRABAJO = arg.trabajo ?? path.join(homedir(), 'likida-loop/frontend-plan/rovaq-method/.trabajo');
const OUT = arg.out ?? path.join(homedir(), 'likida-loop/frontend-plan/rovaq-method');
const ETIQUETA = arg.etiqueta ?? 'v2-actual';
const ANCHOS = String(arg.anchos ?? '1440,1024,768,390').split(',').map(Number);
const TEMAS = String(arg.temas ?? 'claro,oscuro').split(',');
const ALTO = { 1440: 900, 1280: 720, 1024: 768, 768: 1024, 390: 844 };
// N3 (pie del sidebar sin recorte) se mide además a 1280×720, claro, y de esa pasada solo cuentan los n3.*
const N3_EXTRA = { w: 1280, tema: 'claro' };
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
    p.ruta = PANTALLAS_RUTA[p.id] ?? null;
  }
  return lista;
}

/** El arnés ABORTA si la pantalla no es la UI v2. No basta con que la cadena aparezca en el HTML (un comentario, un texto o un
 *  atributo cualquiera la contienen): se valida en el DOM que el ELEMENTO RAÍZ del chrome (`.tema-neutro`) lleva
 *  data-ui="v2" y que dentro de él viven el shell (sidebar o cabecera móvil) y el contenido. Devuelve el motivo o null. */
export const comprobarRaizV2 = (page) => page.evaluate(() => {
  const raices = [...document.querySelectorAll('[data-ui="v2"]')];
  if (!raices.length) return 'ningún elemento lleva data-ui="v2"';
  const raiz = raices.find((r) => r.classList.contains('tema-neutro'));
  if (!raiz) return 'data-ui="v2" no está en el elemento raíz del chrome (.tema-neutro)';
  if (!raiz.querySelector('.rv-sb,.rv-cab-movil')) return 'la raíz v2 no contiene el shell (.rv-sb / .rv-cab-movil)';
  if (!raiz.querySelector('main,#contenido-principal,[role="status"]')) return 'la raíz v2 no contiene el contenido';
  return null;
});
class ArnesSinV2 extends Error {}

/** Ejecuta medir() dentro de la página (la función viaja como texto: es autocontenida). */
export const ejecutar = (page, opts) => page.evaluate(({ src, U, o }) => (0, eval)('(' + src + ')')(U, o), { src: medir.toString(), U: UMBRALES, o: opts });

async function medirPantalla(browser, p, cuerpo, cssRuta, w, tema, { pliegueAplica, carga }) {
  const h = ALTO[w] ?? 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'es-MX', isMobile: w < 500, hasTouch: w < 500 });
  const page = await ctx.newPage();
  const archivo = path.join(TRABAJO, `.doc-${p.id}.html`);
  writeFileSync(archivo, docHtml(cuerpo, cssRuta));
  await page.goto('file://' + archivo);
  { const motivo = await comprobarRaizV2(page); if (motivo) throw new ArnesSinV2(`la pantalla ${p.id}: ${motivo} (render.sh con UI2_CHROME=v2)`); }
  await page.evaluate(async (t) => { document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'); await document.fonts.ready; }, tema);
  // Los Suspense resueltos por prerender se acomodan con un script en línea: se espera a que no queden plantillas ni esqueletos pendientes.
  if (!carga) await page.waitForFunction(() => !document.querySelector('template[id^="B:"]') && !document.querySelector('[role="status"][aria-label="Cargando"]'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(80);
  const res = await ejecutar(page, { pliegue: pliegueAplica, carga, tipo: p.tipo });
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
  const salida = { meta: { version: '2.1', etiqueta: ETIQUETA, fecha: new Date().toISOString(), anchos: ANCHOS, temas: TEMAS, umbrales: UMBRALES, fuentesHanken: hayFuentes, pantallas: pantallas.map((p) => ({ id: p.id, grupo: p.grupo, tipo: p.tipo, ruta: p.ruta })) }, pantallas: {} };
  for (const p of pantallas) {
    // El HTML es estático: no corre el controlador que SUELTA la capa de carga (`data-estado="inicial"` viaja desde el servidor y la
    // deja visible, tapando el marco). Fuera de la pantalla de carga se mide el marco ya liberado (`oculta`), como lo ve el usuario.
    const cuerpo = readFileSync(p.archivo, 'utf8').replace(p.grupo === 'x-carga' ? /$^/ : / data-estado="inicial"/, ' data-estado="oculta"');
    salida.pantallas[p.id] = { grupo: p.grupo, tipo: p.tipo, combinaciones: {} };
    for (const w of ANCHOS) for (const tema of TEMAS) {
      const carga = p.grupo === 'x-carga';
      const pliegueAplica = w === 1440 && TIPOS_CON_PLIEGUE.includes(p.tipo) && !carga;
      let res;
      try { res = await medirPantalla(browser, p, cuerpo, p.css, w, tema, { pliegueAplica, carga }); }
      catch (e) { if (e instanceof ArnesSinV2) { console.error('\nABORTO: ' + e.message); process.exit(4); } res = { n: { error: 1 }, hallazgos: { error: [String(e.message).slice(0, 200)] }, stats: {} }; }
      // En la pantalla de carga solo cuenta c8 (el resto mide el marco, no la carga).
      for (const k of Object.keys(res.n)) if (carga !== k.startsWith('c8.') && k !== 'error') { delete res.n[k]; delete res.hallazgos[k]; }
      salida.pantallas[p.id].combinaciones[`${w}/${tema}`] = { n: res.n, hallazgos: res.hallazgos, stats: res.stats };
      process.stdout.write('.');
    }
    if (p.grupo !== 'x-carga' && ANCHOS.includes(1440) && !arg.sin1280) {
      let res;
      try { res = await medirPantalla(browser, p, cuerpo, p.css, N3_EXTRA.w, N3_EXTRA.tema, { pliegueAplica: false, carga: false }); }
      catch (e) { res = { n: { error: 1 }, hallazgos: { error: [String(e.message).slice(0, 200)] }, stats: {} }; }
      for (const k of Object.keys(res.n)) if (!k.startsWith('n3.') && k !== 'error') { delete res.n[k]; delete res.hallazgos[k]; }
      salida.pantallas[p.id].combinaciones[`${N3_EXTRA.w}/${N3_EXTRA.tema}`] = { n: res.n, hallazgos: res.hallazgos, stats: { pie: res.stats.pie } };
      process.stdout.write('+');
    }
    // c9 en línea: duraciones de transition/animation que el HTML renderizado lleva en style=""
    const dIn = duracionesInline(cuerpo);
    const c0 = salida.pantallas[p.id].combinaciones['1440/claro'] ?? Object.values(salida.pantallas[p.id].combinaciones)[0];
    if (dIn.length && c0) { c0.n['c9.duracion'] = dIn.length; c0.hallazgos['c9.duracion'] = dIn; }
  }
  await browser.close();
  console.log();
  // Globales: no dependen de una pantalla sola.
  salida.global = globales(salida);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, arg.json ?? `medidas-${ETIQUETA}.json`), JSON.stringify(salida, null, 1));
  // Salida por ruta: una JSON por pantalla/ruta (con su tipo, ruta y combinaciones) en medidas-<etiqueta>/
  const dirRuta = path.join(OUT, `medidas-${ETIQUETA}`); mkdirSync(dirRuta, { recursive: true });
  for (const [id, pnt] of Object.entries(salida.pantallas)) writeFileSync(path.join(dirRuta, `${id}.json`), JSON.stringify({ id, ruta: PANTALLAS_RUTA[id] ?? null, tipo: pnt.tipo, etiqueta: ETIQUETA, combinaciones: pnt.combinaciones }, null, 1));
  const md = informe(salida);
  writeFileSync(path.join(OUT, arg.md ?? `INFORME-${ETIQUETA}.md`), md);
  const total = Object.values(salida.pantallas).reduce((a, p) => a + Object.values(p.combinaciones).reduce((b, c) => b + Object.values(c.n).reduce((x, y) => x + y, 0), 0), 0)
    + Object.values(salida.global).reduce((a, g) => a + g.n, 0);
  console.log(`globales: ` + Object.entries(salida.global).map(([k, g]) => `${k}=${g.n}`).join(' '));
  console.log(`${pantallas.length} pantallas × ${ANCHOS.length} anchos × ${TEMAS.length} temas; ${total} hallazgos (suma de combinaciones)`);
  return total;
}

/** Criterios que miran TODO el arnés (no una pantalla): c9 en las hojas de estilo v2 y N4 (variantes de sidebar). */
export function globales(salida) {
  const G = {};
  const css = duracionesCss(path.join(raiz, 'src/app/ui-v2'));
  G['c9.duracion_css'] = { n: css.length, hallazgos: css.slice(0, 400) };
  const sig = {};
  for (const [id, pnt] of Object.entries(salida.pantallas)) {
    if (pnt.grupo === 'x-carga') continue;
    for (const [k, c] of Object.entries(pnt.combinaciones)) { const f = c.stats?.sidebarFirma; if (!f) continue; const [w, tema] = k.split('/'); if (tema !== 'claro' || Number(w) < 768) continue; (sig[w] = sig[w] || {})[f] = (sig[w][f] || []).concat(id); }
  }
  const dif = []; for (const [w, m] of Object.entries(sig)) if (Object.keys(m).length > 1) dif.push(`${w} px: ${Object.keys(m).length} variantes de sidebar (${Object.values(m).map((l) => l.length + ' pantallas').join(' / ')})`);
  G['n4.variantes_sidebar'] = { n: Object.entries(sig).reduce((a, [, m]) => a + Math.max(0, Object.keys(m).length - 1), 0), hallazgos: dif };
  return G;
}

if (arg.selftest) {
  const { selftest } = await import('./selftest.mjs');
  const ok = await selftest({ chromium, docHtml, ejecutar, CRITERIOS, ALTO, comprobarRaizV2 });
  process.exit(ok ? 0 : 1);
}
const total = await correr();
process.exit(total ? 1 : 0);
