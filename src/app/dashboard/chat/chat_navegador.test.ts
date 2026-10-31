/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio repo y un directorio temporal propio */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../../ui-v2/navegador_prueba';

// ═══════════════════════════════════════════════════════════════════════════
// «Pregunta a tus datos» — COMPORTAMIENTO REAL en Chromium (L5). Se empaqueta el ChatFlota VERDADERO (no una copia) con `vite build` en
// memoria, se monta con React en una página con el CSS v2 real y se le pone un `fetch` de mentira que transmite NDJSON como el
// servidor: eventos de paso EN VIVO, el evento final, y un `abort` que sí corta el flujo. Se prueba lo que SOLO ocurre al usar la caja:
// enviar (Enter / Shift+Enter), el streaming de pasos, detener (Esc y botón), el fallo blando con Reintentar, el historial reabierto
// quieto, el movimiento reducido sin animaciones y el campo de puntos que se pausa. Sin Chromium NO se da por bueno
// (`UI2_SIN_NAVEGADOR=1` las omite a propósito).
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd());
const SRC = join(RAIZ, 'src');
const requerir = createRequire(join(RAIZ, 'package.json'));
let browser: Browser | null = null;
let bundle = '';
let css = '';

const FUENTE_ENTRADA = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ChatFlota from '${SRC}/app/dashboard/chat.tsx';
const kpis = { montoComprobado: 12000, viajesLiquidados: 4, conDiferencias: 1, porRevisar: 1, diferenciaDetectada: 300, tasaCuadre: 50 };
const acred = { iva: 1000, peaje: 200, litrosDiesel: 300 };
createRoot(document.getElementById('montaje')).render(createElement(ChatFlota, { kpis, acred }));
`;
const STUB_NAVEGACION = 'export const useSearchParams = () => new URLSearchParams(); export const usePathname = () => "/dashboard/chat";';

beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  browser = await lanzarNavegador();
  const dir = mkdtempSync(join(tmpdir(), 'chat-l5-'));
  const entrada = join(dir, 'entrada.tsx');
  const stub = join(dir, 'navegacion.ts');
  writeFileSync(entrada, FUENTE_ENTRADA);
  writeFileSync(stub, STUB_NAVEGACION);
  const res = await build({
    configFile: false, logLevel: 'silent', root: RAIZ, mode: 'production',
    // vitest corre con NODE_ENV=test: sin esto el JSX sale en modo desarrollo (jsxDEV) contra el runtime de producción de React.
    oxc: { jsx: { runtime: 'automatic', development: false } },
    resolve: {
      alias: [
        { find: /^next\/navigation$/, replacement: stub },
        { find: /^@\//, replacement: `${SRC}/` },
        { find: /^react$/, replacement: requerir.resolve('react') },
        { find: /^react\/jsx-runtime$/, replacement: requerir.resolve('react/jsx-runtime') },
        { find: /^react-dom\/client$/, replacement: requerir.resolve('react-dom/client') },
      ],
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'ChatPrueba', fileName: 'chat' } },
  });
  const salida = Array.isArray(res) ? res[0] : res;
  const rollup = 'output' in salida ? salida.output : [];
  bundle = (rollup.find((o) => o.type === 'chunk') as { code: string }).code;
  const ui = join(SRC, 'app/ui-v2');
  css = ['tokens.css', 'componentes.css', 'graficas.css', 'movimiento.css', 'overlay.css', 'chat.css'].map((f) => readFileSync(join(ui, f), 'utf8')).join('\n');
}, 180_000);
afterAll(async () => { await browser?.close(); });

/** El `fetch` de mentira: JSON para conversaciones, NDJSON controlable (`__flujo`) para el chat, y `abort` que corta el flujo. */
const FETCH_FALSO = `
(() => {
  window.__llamadas = [];
  window.__convs = window.__convs || [];
  const enc = new TextEncoder();
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = (url, init) => {
    const u = String(url);
    window.__llamadas.push({ url: u, body: init && init.body ? String(init.body) : null });
    if (/^\\/api\\/dashboard\\/conversaciones\\/c0/.test(u)) return Promise.resolve(json({ mensajes: [
      { rol: 'usuario', texto: '¿Cuánto llevo comprobado?', bloques: null },
      { rol: 'asistente', texto: 'Llevas $12,000.00 comprobados.', bloques: [
        { tipo: 'texto', texto: 'Llevas $12,000.00 comprobados.' },
        { tipo: 'dona', segmentos: [{ etiqueta: 'Sin diferencias', valor: 3 }, { etiqueta: 'Con diferencias', valor: 1 }] },
      ] },
    ] }));
    if (/^\\/api\\/dashboard\\/conversaciones/.test(u)) return Promise.resolve(json({ conversaciones: window.__convs }));
    if (/^\\/api\\/dashboard\\/chat/.test(u)) {
      if (window.__falla) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(new ReadableStream({
        start(c) {
          window.__flujo = { linea: (o) => c.enqueue(enc.encode(JSON.stringify(o) + '\\n')), cerrar: () => c.close() };
          if (init && init.signal) init.signal.addEventListener('abort', () => { try { c.error(new DOMException('Abort', 'AbortError')); } catch (e) { /* ya cerrado */ } });
        },
      }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return Promise.reject(new Error('sin ruta de prueba: ' + u));
  };
})();
`;

const FIN_COMPLETO = {
  t: 'fin', conversacionId: 'c-1',
  bloques: [
    { tipo: 'texto', texto: 'Llevas $12,000.00 comprobados en 4 viajes.' },
    { tipo: 'tabla', filas: [['Monto comprobado', '$12,000.00'], ['Viajes liquidados', '4']] },
    { tipo: 'dona', segmentos: [{ etiqueta: 'Sin diferencias', valor: 2 }, { etiqueta: 'Con diferencias', valor: 1 }, { etiqueta: 'Por revisar', valor: 1 }] },
  ],
};

async function abrir(ancho: number, alto: number, opts: { reducido?: boolean; convs?: unknown[]; falla?: boolean } = {}): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: alto }, reducedMotion: opts.reducido ? 'reduce' : 'no-preference' });
  await p.addInitScript(`window.__convs = ${JSON.stringify(opts.convs ?? [])}; window.__falla = ${opts.falla ? 'true' : 'false'};`);
  await p.addInitScript(FETCH_FALSO);
  await p.route('http://chat.prueba/', (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="es-MX" data-theme="light"><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0}${css}</style></head>
      <body><div data-ui="v2" class="rv-app tema-neutro"><div class="rv-contenido-prueba"><main class="rv-chat-pagina"><div id="montaje" class="rv-chat-pagina"></div></main></div></div>
      <style>.rv-contenido-prueba{display:flex;flex-direction:column;height:100dvh;padding:8px 20px 16px;overflow:hidden}</style>
      <script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`,
  }));
  const errores: string[] = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await p.goto('http://chat.prueba/');
  await p.waitForSelector('#chat-pregunta', { timeout: 10_000 }).catch(() => { throw new Error(`La caja no se montó. Errores de la página: ${errores.join(' | ') || '(ninguno)'}`); });
  return p;
}

/** Pregunta y espera a que el flujo falso esté abierto (el cliente ya hizo el POST). */
async function preguntar(p: Page, q: string) {
  await p.evaluate(() => { (window as unknown as { __flujo?: unknown }).__flujo = undefined; });
  await p.fill('#chat-pregunta', q);
  await p.press('#chat-pregunta', 'Enter');
  await p.waitForFunction(() => !!(window as unknown as { __flujo?: unknown }).__flujo);
}
const linea = (p: Page, o: unknown) => p.evaluate((x) => (window as unknown as { __flujo: { linea: (o: unknown) => void } }).__flujo.linea(x), o);

describe.skipIf(SIN_NAVEGADOR)('chat · portada y medidas', () => {
  it('portada: título, frase, recuadro de 736 × 58 y temas con sus tres preguntas; campo de puntos pintando', async () => {
    const p = await abrir(1440, 900);
    expect(await p.locator('h1').innerText()).toBe('Pregunta a tus datos');
    const caja = await p.locator('.rv-chat__composer').boundingBox();
    expect(Math.round(caja!.width)).toBe(736);
    expect(Math.round(caja!.height)).toBe(58);
    expect(await p.locator('.rv-chat__tema').count()).toBe(3);
    expect(await p.locator('.rv-chat__q').count()).toBe(3);
    await p.waitForTimeout(400);
    expect(Number(await p.locator('canvas.rv-chat__pixeles').getAttribute('data-frames'))).toBeGreaterThan(1);
    await p.close();
  }, 30_000);

  it('elegir otro tema cambia sus preguntas (el catálogo de Consulta de siempre)', async () => {
    const p = await abrir(1440, 900);
    const antes = await p.locator('.rv-chat__q').first().innerText();
    await p.click('.rv-chat__tema:nth-child(3)');
    expect(await p.locator('.rv-chat__tema:nth-child(3)').getAttribute('aria-pressed')).toBe('true');
    expect(await p.locator('.rv-chat__q').first().innerText()).not.toBe(antes);
    await p.close();
  }, 30_000);

  it('390 px: sin desborde horizontal y el recuadro llena el ancho útil', async () => {
    const p = await abrir(390, 844);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const caja = await p.locator('.rv-chat__composer').boundingBox();
    expect(caja!.width).toBeGreaterThan(390 - 2 * 20 - 2);
    await p.close();
  }, 30_000);
});

describe.skipIf(SIN_NAVEGADOR)('chat · envío y streaming', () => {
  it('Enter envía, Shift+Enter agrega una línea, Enter sin texto no envía', async () => {
    const p = await abrir(1280, 800);
    await p.press('#chat-pregunta', 'Enter');
    expect(await p.evaluate(() => (window as unknown as { __llamadas: unknown[] }).__llamadas.filter((l) => /^\/api\/dashboard\/chat(\?|$)/.test((l as { url: string }).url)).length)).toBe(0);
    await p.fill('#chat-pregunta', 'primera');
    await p.press('#chat-pregunta', 'Shift+Enter');
    await p.type('#chat-pregunta', 'segunda');
    expect(await p.inputValue('#chat-pregunta')).toBe('primera\nsegunda');
    await p.press('#chat-pregunta', 'Enter');
    await p.waitForFunction(() => !!(window as unknown as { __flujo?: unknown }).__flujo);
    expect(await p.locator('.rv-chat__burbuja').innerText()).toContain('primera');
    await p.close();
  }, 30_000);

  it('los pasos del agente llegan EN VIVO, con su tiempo, y la respuesta trae texto, tabla y dona', async () => {
    const p = await abrir(1280, 800);
    await preguntar(p, '¿Cuánto llevo comprobado?');
    // «pensando» con la marca que respira, antes de cualquier paso
    await p.waitForSelector('[data-testid="chat-pensando"]');
    expect(await p.locator('.rv-chat__marca[data-estado="pensando"]').count()).toBe(1);
    await linea(p, { t: 'paso', tool: 'kpis_flota', fase: 'inicio' });
    await p.waitForSelector('.rv-traza__paso[data-listo="false"]');
    expect(await p.locator('.rv-traza__titulo').first().innerText()).toContain('Leyendo los KPIs de la flota');
    await p.waitForTimeout(120);
    await linea(p, { t: 'paso', tool: 'kpis_flota', fase: 'fin' });
    await p.waitForSelector('.rv-traza__paso[data-listo="true"] .rv-traza__meta');
    await linea(p, FIN_COMPLETO);
    await p.evaluate(() => (window as unknown as { __flujo: { cerrar: () => void } }).__flujo.cerrar());
    await p.waitForSelector('[data-tipo="tabla"]', { timeout: 15_000 });
    expect(await p.locator('[data-tipo="tabla"]').innerText()).toContain('Monto comprobado');
    expect(await p.locator('[data-tipo="dona"] svg circle.rv-dona__gajo').count()).toBe(3);
    expect(await p.locator('.rv-chat__sello').innerText()).toContain('Respuesta del analista');
    // la traza guardada queda colapsada con su tiempo total
    expect(await p.locator('details.rv-traza__final').getAttribute('open')).toBeNull();
    expect(await p.locator('.rv-chat__resumen').innerText()).toMatch(/Cómo llegué a esto \(1 paso/);
    // el hilo es un registro anunciado con cortesía
    expect(await p.locator('[role="log"]').getAttribute('aria-live')).toBe('polite');
    // el cuerpo del POST es el de siempre: la pregunta viaja en `mensajes`
    const cuerpo = await p.evaluate(() => (window as unknown as { __llamadas: Array<{ url: string; body: string | null }> }).__llamadas.find((l) => /^\/api\/dashboard\/chat/.test(l.url))!.body);
    expect(JSON.parse(cuerpo!).mensajes.at(-1)).toEqual({ rol: 'usuario', texto: '¿Cuánto llevo comprobado?' });
    await p.close();
  }, 40_000);

  it('Esc DETIENE la generación: el turno queda «detenido» y la caja vuelve a estar libre', async () => {
    const p = await abrir(1280, 800);
    await preguntar(p, 'una pregunta larga');
    await p.waitForSelector('.rv-chat__enviar[aria-label^="Detener"]');
    await p.press('#chat-pregunta', 'Escape');
    await p.waitForSelector('.rv-chat__cancelada');
    expect(await p.locator('.rv-chat__cancelada').innerText()).toContain('Generación detenida');
    await p.waitForSelector('.rv-chat__enviar[aria-label="Enviar"]');
    // y se puede volver a preguntar
    await p.fill('#chat-pregunta', 'otra');
    expect(await p.locator('.rv-chat__enviar').isDisabled()).toBe(false);
    await p.close();
  }, 30_000);

  it('el botón Detener hace lo mismo que Esc', async () => {
    const p = await abrir(1280, 800);
    await preguntar(p, 'pregunta');
    await p.click('.rv-chat__enviar[aria-label^="Detener"]');
    await p.waitForSelector('.rv-chat__cancelada');
    await p.close();
  }, 30_000);
});

describe.skipIf(SIN_NAVEGADOR)('chat · fallo blando y reintento', () => {
  it('si el analista no conecta: aviso blando (rol alert) con la respuesta de reserva declarada y Reintentar que sí vuelve a preguntar', async () => {
    const p = await abrir(1280, 800, { falla: true });
    await p.fill('#chat-pregunta', '¿Cuánto llevo comprobado?');
    await p.press('#chat-pregunta', 'Enter');
    await p.waitForSelector('.rv-chat__aviso[role="alert"]');
    expect(await p.locator('.rv-chat__aviso').innerText()).toContain('No se pudo conectar con el analista');
    expect(await p.locator('.rv-chat__sello').innerText()).toContain('Respuesta de reserva');
    // la reserva sí contesta con lo ya cargado (la tabla de lo comprobado)
    expect(await p.locator('[data-tipo="tabla"]').innerText()).toContain('Monto comprobado');
    // Reintentar: ahora el servidor sí contesta
    await p.evaluate(() => { (window as unknown as { __falla: boolean }).__falla = false; });
    await p.click('button:has-text("Reintentar")');
    await p.waitForFunction(() => !!(window as unknown as { __flujo?: unknown }).__flujo);
    await linea(p, { t: 'fin', bloques: [{ tipo: 'texto', texto: 'Ahora sí.' }] });
    await p.evaluate(() => (window as unknown as { __flujo: { cerrar: () => void } }).__flujo.cerrar());
    await p.waitForFunction(() => document.querySelector('.rv-chat__texto')?.textContent === 'Ahora sí.', undefined, { timeout: 10_000 });
    expect(await p.locator('.rv-chat__aviso').count()).toBe(0);
    expect(await p.locator('.rv-chat__turno').count()).toBe(1); // sustituyó el turno, no lo duplicó
    await p.close();
  }, 40_000);
});

describe.skipIf(SIN_NAVEGADOR)('chat · historial', () => {
  const CONVS = [{ id: 'c0', titulo: 'Cuadre de octubre', actualizadoEn: new Date().toISOString() }];

  it('escritorio: la columna abre con 352 px y se cierra; reabrir una conversación NO re-anima su historial', async () => {
    const p = await abrir(1440, 900, { convs: CONVS });
    await p.waitForFunction(() => document.querySelector('.rv-chat__hist-cuenta')?.textContent === '1');
    await p.click('.rv-chat__hist-boton');
    await p.waitForFunction(() => Math.round(document.querySelector('.rv-chat__hist')!.getBoundingClientRect().width) === 352, undefined, { timeout: 5000 });
    expect(await p.locator('.rv-chat__hist-titulo').first().innerText()).toBe('Hoy');
    await p.click('.rv-chat__hist-fila');
    await p.waitForSelector('.rv-chat__respuesta');
    expect(await p.locator('.rv-chat__respuesta').getAttribute('data-nuevo')).toBe('false');
    await p.waitForTimeout(100);
    const entra = await p.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'rv-chat-entra').length);
    expect(entra).toBe(0);
    // Esc cierra la columna y el foco vuelve al botón
    await p.press('.rv-chat__hist-fila', 'Escape');
    await p.waitForFunction(() => Math.round(document.querySelector('.rv-chat__hist')!.getBoundingClientRect().width) === 0, undefined, { timeout: 5000 });
    await p.close();
  }, 40_000);

  it('390 px: el historial es un Drawer del motor único (dialog modal) y Esc lo cierra', async () => {
    const p = await abrir(390, 844, { convs: CONVS });
    await p.click('.rv-chat__hist-boton');
    await p.waitForSelector('dialog[open]');
    expect(await p.locator('dialog[open] .rv-chat__hist-fila').count()).toBe(1);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog[open]'));
    await p.close();
  }, 30_000);
});

describe.skipIf(SIN_NAVEGADOR)('chat · movimiento', () => {
  it('con una conversación abierta el campo de puntos deja de animar, y «pensando» no anida role=status dentro del log', async () => {
    const p = await abrir(1280, 800);
    await p.waitForTimeout(300);
    await preguntar(p, 'hola');
    await p.waitForSelector('[data-testid="chat-pensando"]');
    await p.waitForTimeout(150);
    const quieto = await p.locator('canvas.rv-chat__pixeles').getAttribute('data-frames');
    await p.waitForTimeout(400);
    expect(await p.locator('canvas.rv-chat__pixeles').getAttribute('data-frames')).toBe(quieto);
    expect(await p.locator('[role="log"] [role="status"]').count()).toBe(0);
    await p.close();
  }, 30_000);

  it('con movimiento permitido: el mensaje nuevo entra con rv-chat-entra y el campo de puntos sigue pintando', async () => {
    const p = await abrir(1280, 800);
    await preguntar(p, 'hola');
    const nombres = await p.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName));
    expect(nombres).toContain('rv-chat-entra');
    expect(nombres).toContain('rv-chat-respira'); // la marca del «pensando»
    await p.close();
  }, 30_000);

  it('con movimiento REDUCIDO: cero animaciones, el campo de puntos pinta UN cuadro y la respuesta aparece completa de una vez', async () => {
    const p = await abrir(1280, 800, { reducido: true });
    await p.waitForTimeout(500);
    expect(Number(await p.locator('canvas.rv-chat__pixeles').getAttribute('data-frames'))).toBe(1);
    await preguntar(p, 'hola');
    await linea(p, { t: 'paso', tool: 'kpis_flota', fase: 'inicio' });
    await linea(p, FIN_COMPLETO);
    await p.evaluate(() => (window as unknown as { __flujo: { cerrar: () => void } }).__flujo.cerrar());
    await p.waitForSelector('[data-tipo="dona"]');
    // el texto completo está ya (sin escritura progresiva) y no queda NINGUNA animación viva
    expect(await p.locator('.rv-chat__texto').first().innerText()).toBe('Llevas $12,000.00 comprobados en 4 viajes.');
    expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
    await p.close();
  }, 30_000);

  it('el campo de puntos se PAUSA con la pestaña oculta y se reanuda al volver', async () => {
    const p = await abrir(1280, 800);
    await p.waitForTimeout(300);
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(150);
    const quieto = await p.locator('canvas.rv-chat__pixeles').getAttribute('data-frames');
    await p.waitForTimeout(400);
    expect(await p.locator('canvas.rv-chat__pixeles').getAttribute('data-frames')).toBe(quieto);
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(400);
    expect(Number(await p.locator('canvas.rv-chat__pixeles').getAttribute('data-frames'))).toBeGreaterThan(Number(quieto));
    await p.close();
  }, 30_000);
});
