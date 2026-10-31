// Capturas y TIEMPOS de animación de «Pregunta a tus datos» (L5). Monta el ChatFlota VERDADERO (empaquetado con vite) dentro del chrome
// v2 que renderiza `l5.harness.tsx`, lo maneja con un `fetch` de mentira (NDJSON con pasos en vivo) y fotografía: portada con el campo
// de puntos, conversación con tabla/dona, serie, «pensando» a medias y fallo blando — a 1440 y 390, claro y oscuro.
// Uso: node scripts/ui2-captura/capturar-chat.mjs [--out=DIR_ARNES] [--dest=DIR_CAPTURAS]
// Requiere antes: `UI2_OUT=<out> npx vitest run --config scripts/ui2-captura/vitest.config.mts l5` y
//                 `node scripts/ui2-captura/compilar-css.mjs <out>` (genera v2full.css con chat.css).
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requerir = createRequire(path.join(raiz, 'package.json'));
const { chromium } = requerir('playwright');
const { build } = requerir('vite');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = arg.out ?? path.join(homedir(), 'likida-loop/cierre100/arnes-l5');
const DEST = arg.dest ?? path.join(homedir(), 'likida-loop/cierre100/capt-l5');
mkdirSync(DEST, { recursive: true });
const SRC = path.join(raiz, 'src');

// ── 1. El bundle del chat real ───────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(path.join(tmpdir(), 'chat-capt-'));
writeFileSync(path.join(tmp, 'nav.ts'), 'export const useSearchParams = () => new URLSearchParams();');
writeFileSync(path.join(tmp, 'entrada.tsx'), `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ChatFlota from '${SRC}/app/dashboard/chat.tsx';
const kpis = { montoComprobado: 1284000, viajesLiquidados: 42, conDiferencias: 5, porRevisar: 3, diferenciaDetectada: 18400, tasaCuadre: 81 };
const acred = { iva: 96800, peaje: 21400, litrosDiesel: 18250 };
createRoot(document.getElementById('montaje')).render(createElement(ChatFlota, { kpis, acred }));
`);
const res = await build({
  configFile: false, logLevel: 'silent', root: raiz, mode: 'production',
  oxc: { jsx: { runtime: 'automatic', development: false } },
  resolve: { alias: [
    { find: /^next\/navigation$/, replacement: path.join(tmp, 'nav.ts') }, { find: /^@\//, replacement: `${SRC}/` },
    { find: /^react$/, replacement: requerir.resolve('react') }, { find: /^react\/jsx-runtime$/, replacement: requerir.resolve('react/jsx-runtime') },
    { find: /^react-dom\/client$/, replacement: requerir.resolve('react-dom/client') },
  ] },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: { write: false, minify: false, lib: { entry: path.join(tmp, 'entrada.tsx'), formats: ['iife'], name: 'ChatCaptura', fileName: 'chat' } },
});
const bundle = (Array.isArray(res) ? res[0] : res).output.find((o) => o.type === 'chunk').code.replace(/<\/script>/g, '<\\/script>');

// ── 2. El documento: CSS compilado + fuentes + chrome estático + bundle ───────────────────────────────
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');
const ff = (fam, w, f) => `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:block;src:url('http://likida.captura/fonts/${f}') format('woff2')}`;
const fuentes = [
  ...[400, 500, 600, 700].map((w) => ff('Hanken Grotesk UI', w, `hankengrotesk-${w}.woff2`)),
  ...[400, 500].map((w) => ff('IBM Plex Mono', w, `plexmono-${w}.woff2`)),
  `html{--font-sans-ui:'Hanken Grotesk UI',system-ui,sans-serif;--font-display:'Hanken Grotesk UI',system-ui,sans-serif;--font-mono:'IBM Plex Mono',monospace}`,
].join('\n');
const css = readFileSync(path.join(OUT, 'v2full.css'), 'utf8') + '\n' + fuentes;
const shell = readFileSync(path.join(OUT, 'vistas', 'l5-chat.html'), 'utf8').replace(' data-estado="inicial"', ' data-estado="oculta"');

// El fetch de mentira: JSON para conversaciones; NDJSON controlable (`__flujo`) para el chat, y abort que corta el flujo.
const FETCH_FALSO = `(() => {
  window.__convs = window.__convs || [];
  const enc = new TextEncoder();
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = (url, init) => {
    const u = String(url);
    if (/^\\/api\\/dashboard\\/conversaciones/.test(u)) return Promise.resolve(json({ conversaciones: window.__convs }));
    if (/^\\/api\\/dashboard\\/chat/.test(u)) {
      if (window.__falla) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(new ReadableStream({ start(c) {
        window.__flujo = { linea: (o) => c.enqueue(enc.encode(JSON.stringify(o) + '\\n')), cerrar: () => c.close() };
        if (init && init.signal) init.signal.addEventListener('abort', () => { try { c.error(new DOMException('Abort', 'AbortError')); } catch (e) {} });
      } }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return Promise.reject(new Error('sin ruta: ' + u));
  };
})();`;

// Registro de tiempos de animación: cada animación CSS que arranca, con su duración, retardo y curva reales (de getAnimations()).
const REGISTRO = `(() => {
  window.__tiempos = [];
  const t0 = performance.now();
  const anota = () => {
    for (const a of document.getAnimations()) {
      if (a.__visto) continue; a.__visto = true;
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      const el = a.effect && a.effect.target;
      window.__tiempos.push({ nombre: a.animationName || a.transitionProperty || 'otra', tipo: a.constructor.name, clase: el && el.className && String(el.className.baseVal ?? el.className).split(' ').slice(0, 2).join('.'), inicioMs: Math.round(performance.now() - t0), duracionMs: Math.round(t.duration || 0), retardoMs: Math.round(t.delay || 0), iteraciones: t.iterations === Infinity ? 'infinito' : t.iterations, curva: a.effect.getTiming().easing });
    }
  };
  new MutationObserver(anota).observe(document, { subtree: true, childList: true, attributes: true });
  setInterval(anota, 30);
})();`;

const doc = `<!doctype html><html lang="es-MX" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${shell}<script>${bundle}</script></body></html>`;
const docPath = path.join(OUT, 'vistas', 'l5-chat.doc.html');
writeFileSync(docPath, doc);

const FIN_1 = { t: 'fin', conversacionId: 'c-1', bloques: [
  { tipo: 'texto', texto: 'Llevas $1,284,000.00 comprobados en 42 viajes liquidados; 5 tienen diferencia y 3 están por revisar.' },
  { tipo: 'tabla', filas: [['Monto comprobado', '$1,284,000.00'], ['Viajes liquidados', '42'], ['Con diferencias', '5'], ['Por revisar', '3'], ['Fuera de regla o duplicado', '$18,400.00']] },
  { tipo: 'dona', segmentos: [{ etiqueta: 'Sin diferencias', valor: 34 }, { etiqueta: 'Con diferencias', valor: 5 }, { etiqueta: 'Por revisar', valor: 3 }] },
] };
const SEMANAS = [182, 204, 196, 231, 219, 248, 262, 241, 275, 290];
const FIN_2 = { t: 'fin', conversacionId: 'c-1', bloques: [
  { tipo: 'texto', texto: 'El gasto por semana de las últimas diez semanas va al alza: la semana más reciente suma $290,000.00.' },
  { tipo: 'cifra', valor: 290000, formato: 'mxn', nota: 'Semana más reciente' },
  { tipo: 'serie', formato: 'mxn', puntos: SEMANAS.map((v, i) => ({ dia: `S${i + 1}`, valor: v * 1000 })) },
] };

const ANCHOS = [[1440, 900], [390, 844]];
const TEMAS = ['claro', 'oscuro'];
const tiempos = {};
const browser = await chromium.launch();

async function rutas(page) {
  await page.route('http://likida.captura/', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: doc }));
  await page.route('http://likida.captura/fonts/*', (r) => r.fulfill({ contentType: 'font/woff2', body: readFileSync(path.join(F, r.request().url().split('/').pop())) }));
}
async function abrir(w, h, tema, { falla = false, convs = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'es-MX', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(`window.__convs=${JSON.stringify(convs)};window.__falla=${falla};`);
  await page.addInitScript(FETCH_FALSO);
  await page.addInitScript(REGISTRO);
  await rutas(page);
  await page.goto('http://likida.captura/');
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'), tema);
  await page.waitForSelector('#chat-pregunta');
  return { ctx, page };
}
const linea = (page, o) => page.evaluate((x) => window.__flujo.linea(x), o);
async function preguntar(page, q) {
  await page.evaluate(() => { window.__flujo = undefined; });
  await page.fill('#chat-pregunta', q);
  await page.press('#chat-pregunta', 'Enter');
  await page.waitForFunction(() => !!window.__flujo);
}
async function cerrar(page) { await page.evaluate(() => window.__flujo.cerrar()); }
const foto = (page, nombre, w, tema) => page.screenshot({ path: path.join(DEST, `${nombre}__${w}__${tema}.png`), animations: 'allow' });
const guardarTiempos = async (page, clave) => { tiempos[clave] = await page.evaluate(() => window.__tiempos); };

for (const [w, h] of ANCHOS) {
  for (const tema of TEMAS) {
    // A — portada con el campo de puntos y las sugerencias entrando
    {
      const { ctx, page } = await abrir(w, h, tema, { convs: [{ id: 'c0', titulo: 'Cuadre de octubre', actualizadoEn: new Date().toISOString() }] });
      await page.waitForTimeout(1600);
      await foto(page, 'l5-01-vacio', w, tema);
      const medida = await page.evaluate(() => { const c = document.querySelector('.rv-chat__composer').getBoundingClientRect(); const cv = document.querySelector('canvas.rv-chat__pixeles'); return { composer: [Math.round(c.width), Math.round(c.height)], drawMs: cv.dataset.drawMs, frames: cv.dataset.frames }; });
      tiempos[`vacio__${w}__${tema}__medidas`] = medida;
      await guardarTiempos(page, `vacio__${w}__${tema}`);
      await ctx.close();
    }
    // B — «pensando» a medias, conversación con tabla + dona, y segunda pregunta con serie
    {
      const { ctx, page } = await abrir(w, h, tema);
      await preguntar(page, '¿Cuánto llevo comprobado?');
      await linea(page, { t: 'paso', tool: 'kpis_flota', fase: 'inicio' });
      await page.waitForTimeout(450);
      await linea(page, { t: 'paso', tool: 'kpis_flota', fase: 'fin' });
      await linea(page, { t: 'paso', tool: 'motor_fiscal', fase: 'inicio' });
      await page.waitForTimeout(700);
      await foto(page, 'l5-02-pensando', w, tema);
      await linea(page, { t: 'paso', tool: 'motor_fiscal', fase: 'fin' });
      await linea(page, FIN_1); await cerrar(page);
      await page.waitForSelector('[data-tipo="dona"]', { timeout: 15000 });
      await page.waitForTimeout(1100); // el trazo de la dona (700 ms) y la entrada del bloque terminan
      await foto(page, 'l5-03-conversacion-tabla-dona', w, tema);
      await preguntar(page, 'Muéstrame el gasto por semana');
      await linea(page, { t: 'paso', tool: 'serie_gasto', fase: 'inicio' });
      await page.waitForTimeout(300);
      await linea(page, { t: 'paso', tool: 'serie_gasto', fase: 'fin' });
      await linea(page, FIN_2); await cerrar(page);
      await page.waitForSelector('[data-tipo="serie"]', { timeout: 15000 });
      await page.waitForTimeout(900);
      await foto(page, 'l5-04-conversacion-serie', w, tema);
      await guardarTiempos(page, `conversacion__${w}__${tema}`);
      await ctx.close();
    }
    // C — fallo blando con Reintentar
    {
      const { ctx, page } = await abrir(w, h, tema, { falla: true });
      await page.fill('#chat-pregunta', '¿Cuánto llevo comprobado?');
      await page.press('#chat-pregunta', 'Enter');
      await page.waitForSelector('.rv-chat__aviso[role="alert"]');
      await page.waitForTimeout(1500);
      await foto(page, 'l5-05-error-blando', w, tema);
      await ctx.close();
    }
    // D — historial abierto (columna en escritorio, hoja inferior en celular)
    {
      const { ctx, page } = await abrir(w, h, tema, { convs: [
        { id: 'c0', titulo: 'Cuadre de octubre', actualizadoEn: new Date().toISOString() },
        { id: 'c1', titulo: 'IVA y peaje acreditables', actualizadoEn: new Date(Date.now() - 86400000).toISOString() },
        { id: 'c2', titulo: 'Diésel elegible para el estímulo', actualizadoEn: new Date(Date.now() - 5 * 86400000).toISOString() },
      ] });
      await page.waitForFunction(() => document.querySelector('.rv-chat__hist-cuenta')?.textContent === '3');
      await page.click('.rv-chat__hist-boton');
      await page.waitForTimeout(800);
      await foto(page, 'l5-06-historial', w, tema);
      await ctx.close();
    }
  }
}
// E — movimiento reducido (una sola captura de control: cero animaciones vivas)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', locale: 'es-MX' });
  const page = await ctx.newPage();
  await page.addInitScript(FETCH_FALSO);
  await rutas(page);
  await page.goto('http://likida.captura/');
  await page.waitForSelector('#chat-pregunta');
  await preguntar(page, '¿Cuánto llevo comprobado?');
  await linea(page, FIN_1); await cerrar(page);
  await page.waitForSelector('[data-tipo="dona"]');
  tiempos['reducido'] = { animacionesVivas: await page.evaluate(() => document.getAnimations().length), cuadrosDelCampo: await page.evaluate(() => document.querySelector('canvas.rv-chat__pixeles').dataset.frames) };
  await page.screenshot({ path: path.join(DEST, 'l5-07-movimiento-reducido__1440__claro.png') });
  await ctx.close();
}
await browser.close();

// Resumen de tiempos: una fila por animación distinta (nombre + duración + retardo + curva), con cuántas veces ocurrió.
const resumen = {};
for (const [clave, lista] of Object.entries(tiempos)) {
  if (!Array.isArray(lista)) continue;
  for (const a of lista) {
    const k = `${a.nombre} | ${a.duracionMs} ms | retardo ${a.retardoMs} ms | ${a.curva} | x${a.iteraciones}`;
    resumen[k] = (resumen[k] ?? 0) + 1;
  }
}
writeFileSync(path.join(DEST, 'tiempos.json'), JSON.stringify({ tiempos, resumen }, null, 2));
console.log(Object.entries(resumen).sort().map(([k, n]) => `${n}\t${k}`).join('\n'));
console.log('medidas', JSON.stringify(Object.fromEntries(Object.entries(tiempos).filter(([k]) => k.endsWith('__medidas')))));
console.log('reducido', JSON.stringify(tiempos.reducido));
