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
// EL COPILOTO DE /admin — COMPORTAMIENTO REAL en Chromium con el componente UNIFICADO (modo superadmin), el panel con ⌘J y la acción
// con confirmación. Se empaquetan la página y el panel VERDADEROS con vite en memoria y se les pone un `fetch` de mentira que transmite
// NDJSON como /api/admin/copiloto. Sin Chromium NO se da por bueno (`UI2_SIN_NAVEGADOR=1` las omite a propósito).
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
import AgenteConversacion from '${SRC}/app/dashboard/chat/agente-conversacion.tsx';
import CopilotoPanel from '${SRC}/app/admin/copiloto-panel.tsx';
const panel = location.hash === '#panel';
createRoot(document.getElementById('montaje')).render(panel
  ? createElement(CopilotoPanel)
  : createElement(AgenteConversacion, { modo: 'superadmin', variante: 'pagina' }));
`;
const STUB_LINK = 'import { createElement } from "react"; export default function Link({ href, children, ...r }) { return createElement("a", { href, ...r }, children); }';

const STUB_NAVEGACION = 'export const useSearchParams = () => new URLSearchParams(); export const usePathname = () => "/admin/copiloto";'; // el modo cliente (mismo paquete) lee ?tenant=

beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  browser = await lanzarNavegador();
  const dir = mkdtempSync(join(tmpdir(), 'agente-admin-'));
  const entrada = join(dir, 'entrada.tsx');
  const link = join(dir, 'link.ts');
  writeFileSync(entrada, FUENTE_ENTRADA);
  writeFileSync(link, STUB_LINK);
  const nav = join(dir, 'nav.ts');
  writeFileSync(nav, STUB_NAVEGACION);
  const res = await build({
    configFile: false, logLevel: 'silent', root: RAIZ, mode: 'production',
    oxc: { jsx: { runtime: 'automatic', development: false } },
    resolve: {
      alias: [
        { find: /^next\/link$/, replacement: link },
        { find: /^next\/navigation$/, replacement: nav },
        { find: /^@\//, replacement: `${SRC}/` },
        { find: /^react$/, replacement: requerir.resolve('react') },
        { find: /^react\/jsx-runtime$/, replacement: requerir.resolve('react/jsx-runtime') },
        { find: /^react-dom\/client$/, replacement: requerir.resolve('react-dom/client') },
      ],
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { write: false, minify: false, cssCodeSplit: false, lib: { entry: entrada, formats: ['iife'], name: 'AgentePrueba', fileName: 'agente' } },
  });
  const salida = Array.isArray(res) ? res[0] : res;
  const rollup = 'output' in salida ? salida.output : [];
  bundle = (rollup.find((o) => o.type === 'chunk') as { code: string }).code;
  const ui = join(SRC, 'app/ui-v2');
  css = ['tokens.css', 'componentes.css', 'graficas.css', 'movimiento.css', 'overlay.css', 'chat.css'].map((f) => readFileSync(join(ui, f), 'utf8')).join('\n');
}, 180_000);
afterAll(async () => { await browser?.close(); });

/** El `fetch` de mentira de /api/admin/copiloto: NDJSON controlable para el chat; JSON para la acción (con `intentId`) y el historial. */
const FETCH_FALSO = `
(() => {
  window.__llamadas = [];
  const enc = new TextEncoder();
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = (url, init) => {
    const u = String(url);
    const body = init && init.body ? String(init.body) : null;
    window.__llamadas.push({ url: u, method: (init && init.method) || 'GET', body });
    if (/^\\/api\\/admin\\/copiloto\\/conversaciones/.test(u)) return Promise.resolve(json({ conversaciones: window.__convs || [] }));
    if (u === '/api/admin/copiloto' && init && init.method === 'POST') {
      const cuerpo = JSON.parse(body);
      if (cuerpo.intentId) return Promise.resolve(window.__respuestaAccion ? json(window.__respuestaAccion) : json({ ok: true, mensaje: 'Agente cobranza apagado.' }));
      return Promise.resolve(new Response(new ReadableStream({
        start(c) {
          window.__flujo = { linea: (o) => c.enqueue(enc.encode(JSON.stringify(o) + '\\n')), cerrar: () => c.close() };
          if (init.signal) init.signal.addEventListener('abort', () => { try { c.error(new DOMException('Abort', 'AbortError')); } catch (e) { /* ya cerrado */ } });
        },
      }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return Promise.reject(new Error('sin ruta de prueba: ' + u));
  };
})();
`;

const llamadas = (p: Page) => p.evaluate(() => (window as unknown as { __llamadas: Array<{ url: string; method: string; body: string | null }> }).__llamadas);
const linea = (p: Page, o: unknown) => p.evaluate((x) => (window as unknown as { __flujo: { linea: (o: unknown) => void } }).__flujo.linea(x), o);

async function abrir(opts: { panel?: boolean; convs?: unknown[]; respuestaAccion?: unknown; reducido?: boolean } = {}): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: opts.reducido ? 'reduce' : 'no-preference' });
  await p.addInitScript(`window.__convs = ${JSON.stringify(opts.convs ?? [])}; window.__respuestaAccion = ${JSON.stringify(opts.respuestaAccion ?? null)};`);
  await p.addInitScript(FETCH_FALSO);
  await p.route('http://admin.prueba/**', (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="es-MX" data-theme="light"><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0}:root{--font-sans-ui:system-ui,sans-serif}${css}</style></head>
      <body><div data-ui="v2" class="tema-neutro" style="display:flex;height:100dvh"><div id="montaje" style="flex:1;display:flex;min-width:0;height:calc(100dvh - 2rem)"></div></div>
      <script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`,
  }));
  const errores: string[] = [];
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto(`http://admin.prueba/${opts.panel ? '#panel' : ''}`);
  await p.waitForSelector(opts.panel ? '.rv-copiloto-panel' : '#chat-pregunta', { timeout: 10_000, state: 'attached' }).catch(() => { throw new Error(`No se montó. Errores: ${errores.join(' | ') || '(ninguno)'}`); });
  return p;
}

async function preguntar(p: Page, q: string) {
  await p.evaluate(() => { (window as unknown as { __flujo?: unknown }).__flujo = undefined; });
  await p.fill('#chat-pregunta', q);
  await p.press('#chat-pregunta', 'Enter');
  await p.waitForFunction(() => !!(window as unknown as { __flujo?: unknown }).__flujo);
}

const FIN_ACCION = {
  t: 'fin', conversacionId: 'cc-1', toolsUsadas: ['estado_agentes', 'proponer_accion'],
  bloques: [
    { tipo: 'texto', texto: 'Esto es lo que haría.' },
    { tipo: 'accion', accion: 'apagar_agente', gateo: 'confirma', implementada: true, objetivo: 'cobranza', efecto: 'Deja de enviar recordatorios.', revertir: 'Encenderlo desde Agentes.', motivoSugerido: null, intentId: 'intent-1' },
  ],
};

describe.skipIf(SIN_NAVEGADOR)('copiloto unificado · página', () => {
  it('portada idéntica a «Pregunta a tus datos»: recuadro 736 × 58, título 20/600, temas con punto, sin clip', async () => {
    const p = await abrir();
    expect(await p.locator('h1').innerText()).toBe('El copiloto del fundador');
    const caja = await p.locator('.rv-chat__composer').boundingBox();
    expect(Math.round(caja!.width)).toBe(736);
    expect(Math.round(caja!.height)).toBe(58);
    expect(await p.locator('.rv-chat__hero h1').evaluate((e) => `${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}`)).toBe('20px/600');
    expect(await p.locator('.rv-chat__tema').count()).toBe(3);
    expect(await p.locator('.rv-chat__clip').count()).toBe(0);
    await p.close();
  }, 40_000);

  it('envío con pasos EN VIVO, fuentes clicables y tarjeta de acción que NO ejecuta hasta confirmar con motivo', async () => {
    const p = await abrir();
    await preguntar(p, 'Apaga el agente de cobranza');
    await p.waitForSelector('[data-testid="chat-pensando"]');
    await linea(p, { t: 'paso', tool: 'estado_agentes', fase: 'inicio' });
    await p.waitForSelector('.rv-traza__paso[data-listo="false"]');
    expect(await p.locator('.rv-traza__titulo').first().innerText()).toContain('Consultando el estado de los agentes');
    await linea(p, { t: 'paso', tool: 'estado_agentes', fase: 'fin' });
    await linea(p, FIN_ACCION);
    await p.evaluate(() => (window as unknown as { __flujo: { cerrar: () => void } }).__flujo.cerrar());
    await p.waitForSelector('.rv-accion[data-estado="lista"]', { timeout: 15_000 });
    expect(await p.locator('.rv-chat__sello').innerText()).toContain('Respuesta del copiloto');
    expect(await p.locator('.rv-chat__fuente').first().getAttribute('href')).toBe('/admin/observabilidad');
    // el cuerpo del POST de la pregunta es el de siempre
    const pregunta = (await llamadas(p)).find((l) => l.method === 'POST')!;
    expect(JSON.parse(pregunta.body!).mensajes.at(-1)).toEqual({ rol: 'usuario', texto: 'Apaga el agente de cobranza' });
    // aún NO se ejecutó nada: la única POST es la pregunta
    expect((await llamadas(p)).filter((l) => l.body?.includes('intentId')).length).toBe(0);
    // sin motivo no ejecuta
    await p.click('.rv-accion button:has-text("Apagar")');
    await p.waitForSelector('.rv-accion [role="alert"]');
    expect((await llamadas(p)).filter((l) => l.body?.includes('intentId')).length).toBe(0);
    // con motivo, presenta la llave del servidor (no un booleano del cliente)
    await p.fill('.rv-accion input', 'Pausa por revisión');
    await p.click('.rv-accion button:has-text("Apagar")');
    await p.waitForSelector('.rv-accion[data-estado="hecha"]');
    const ejecuta = (await llamadas(p)).filter((l) => l.body?.includes('intentId'));
    expect(ejecuta.length).toBe(1);
    expect(JSON.parse(ejecuta[0].body!)).toEqual({ intentId: 'intent-1', accion: { id: 'apagar_agente', objetivo: 'cobranza', motivo: 'Pausa por revisión' } });
    await p.waitForFunction(() => document.body.textContent?.includes('Agente cobranza apagado.'));
    await p.close();
  }, 40_000);

  it('cancelar la acción no mueve la palanca', async () => {
    const p = await abrir();
    await preguntar(p, 'Apaga el agente de cobranza');
    await linea(p, FIN_ACCION);
    await p.evaluate(() => (window as unknown as { __flujo: { cerrar: () => void } }).__flujo.cerrar());
    await p.waitForSelector('.rv-accion[data-estado="lista"]', { timeout: 15_000 });
    await p.click('.rv-accion button:has-text("Cancelar")');
    await p.waitForSelector('.rv-accion[data-estado="cancelada"]');
    expect((await llamadas(p)).filter((l) => l.body?.includes('intentId')).length).toBe(0);
    await p.close();
  }, 40_000);

  it('doble confirmación: el primer POST arma, el segundo ejecuta', async () => {
    const p = await abrir({ respuestaAccion: { ok: true, armado: true } });
    await preguntar(p, 'Apaga el agente de cobranza');
    await linea(p, { ...FIN_ACCION, bloques: [FIN_ACCION.bloques[0], { ...FIN_ACCION.bloques[1], gateo: 'doble' }] });
    await p.evaluate(() => (window as unknown as { __flujo: { cerrar: () => void } }).__flujo.cerrar());
    await p.waitForSelector('.rv-accion[data-estado="lista"]', { timeout: 15_000 });
    await p.fill('.rv-accion input', 'motivo');
    await p.click('.rv-accion button:has-text("Apagar")');
    await p.waitForSelector('.rv-accion[data-estado="armada"]');
    expect(await p.locator('.rv-accion button.rv-btn--primary').innerText()).toBe('Confirmar de nuevo');
    await p.close();
  }, 40_000);

  it('Esc DETIENE la generación y la caja vuelve a estar libre', async () => {
    const p = await abrir();
    await preguntar(p, 'una pregunta larga');
    await p.waitForSelector('.rv-chat__enviar[aria-label^="Detener"]');
    await p.press('#chat-pregunta', 'Escape');
    await p.waitForSelector('.rv-chat__cancelada');
    expect(await p.locator('.rv-chat__cancelada').innerText()).toContain('Generación detenida');
    await p.waitForSelector('.rv-chat__enviar[aria-label="Enviar"]');
    await p.close();
  }, 40_000);

  it('un fallo del servidor se declara con Reintentar (sin respuesta de reserva inventada)', async () => {
    const p = await abrir();
    await p.evaluate(() => { const f = window.fetch; window.fetch = (u, i) => (String(u) === '/api/admin/copiloto' ? Promise.reject(new TypeError('x')) : f(u, i)); });
    await p.fill('#chat-pregunta', '¿Cómo va el negocio?');
    await p.press('#chat-pregunta', 'Enter');
    await p.waitForSelector('.rv-chat__aviso[role="alert"]');
    expect(await p.locator('.rv-chat__aviso').innerText()).toContain('El copiloto no pudo responder');
    expect(await p.locator('button:has-text("Reintentar")').count()).toBe(1);
    await p.close();
  }, 40_000);

  it('historial: lista con su conteo, y con la lista llena confiesa el tope de 100', async () => {
    const hoy = new Date().toISOString();
    const convs = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, titulo: `Chat ${i}`, actualizadoEn: hoy }));
    const p = await abrir({ convs });
    await p.waitForSelector('.rv-chat__hist-cuenta');
    expect(await p.locator('.rv-chat__hist-cuenta').innerText()).toBe('100+');
    await p.click('.rv-chat__hist-boton');
    await p.waitForSelector('#chat-historial[data-abierto="true"]');
    expect(await p.locator('#chat-historial').innerText()).toContain('Las 100 más recientes');
    await p.close();
  }, 40_000);
});

describe.skipIf(SIN_NAVEGADOR)('copiloto unificado · panel lateral', () => {
  it('⌘J abre y cierra el panel de 400 px; cerrado no pide nada a la red; la lista del historial se carga al abrir el historial', async () => {
    const p = await abrir({ panel: true, convs: [{ id: 'c1', titulo: 'Costo de IA', actualizadoEn: new Date().toISOString() }] });
    const aside = p.locator('aside.rv-copiloto-panel');
    expect(await aside.getAttribute('data-abierto')).toBe('false');
    expect((await llamadas(p)).length).toBe(0);
    await p.keyboard.press('Meta+j');
    await p.waitForSelector('aside.rv-copiloto-panel[data-abierto="true"]');
    await p.waitForTimeout(700);
    expect(Math.round((await aside.boundingBox())!.width)).toBe(400);
    expect(await p.locator('aside .rv-chat[data-variante="panel"]').count()).toBe(1);
    expect((await llamadas(p)).length).toBe(0);
    await p.click('aside .rv-chat__hist-boton');
    await p.waitForFunction(() => document.body.textContent?.includes('Costo de IA'));
    expect((await llamadas(p)).some((l) => l.url === '/api/admin/copiloto/conversaciones')).toBe(true);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+j');
    await p.waitForSelector('aside.rv-copiloto-panel[data-abierto="false"]');
    await p.close();
  }, 40_000);

  it('el evento likida:abrir-copiloto (⌘K → «Abrir el copiloto») lo abre', async () => {
    const p = await abrir({ panel: true });
    await p.evaluate(() => window.dispatchEvent(new Event('likida:abrir-copiloto')));
    await p.waitForSelector('aside.rv-copiloto-panel[data-abierto="true"]');
    await p.close();
  }, 40_000);
});
