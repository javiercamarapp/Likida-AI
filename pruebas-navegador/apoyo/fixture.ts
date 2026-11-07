import { test as base, type Page } from '@playwright/test';
import { crearProxyLocalE2E } from '../../scripts/ci/e2e/proxy-local.mjs';

// CT-BAS-07 · «strict mode violation ... resolved to 2 elements» (#folio, input[name="q"], summary «Importar desde tu TMS», filas
// del registro, getByLabel de subidas). Evidencia de CI (run 41650614822, traza de importacion-roles.nav.ts): en la instantánea
// previa al clic el DOM tenía DOS copias de la página: la visible dentro de `#contenido-principal` y otra bajo `<div id="S:0"
// hidden>` en <body>, la PLANTILLA de streaming de React (Suspense) que aún no se había intercambiado. Los localizadores de
// Playwright cuentan los elementos ocultos, así que `page.locator('#folio')` resolvía a 2 justo en esa ventana. No es un id duplicado
// ni un doble render del producto (el HTML de la app tiene un solo `#folio`, un solo `summary`), es la carrera de la prueba contra
// el intercambio de la frontera Suspense. Después de CADA `goto` se espera a que ya no quede ninguna plantilla `S:n` oculta; no se
// traga el error: si la plantilla NUNCA se intercambia (CSP del `$RC`, hidratación rota), la prueba falla ahí, con nombre, que es
// un defecto real del producto y no un parpadeo.
export const SIN_PLANTILLAS_STREAMING = `!document.querySelector('body > div[hidden][id^="S:"]')`;

// Función (no cadena): Playwright evalúa una cadena con eval() en la página y la CSP del producto la bloquea
// («Evaluating a string as JavaScript violates the following Content Security Policy directive»); una función viaja por
// el protocolo del navegador y no cae bajo la CSP. El selector se pasa como argumento para tener una sola fuente.
async function esperarSegmentos(page: Page): Promise<void> {
  // Mejor esfuerzo: una pagina puede conservar legitimamente una plantilla oculta (frontera Suspense pendiente, redireccion, pagina de
  // error). Si pasan 6 s sin intercambio se sigue como antes de CT-BAS-07 (el CI mostro que un timeout duro tumbaba pruebas sanas).
  await page.waitForFunction(
    (selector: string) => !document.querySelector(selector),
    'body > div[hidden][id^="S:"]',
    { timeout: 6_000 },
  ).catch(() => undefined);
}

function esperarStreamingTrasGoto(page: Page): void {
  const irA = page.goto.bind(page);
  page.goto = (async (...args: Parameters<Page['goto']>) => {
    const respuesta = await irA(...args);
    await esperarSegmentos(page);
    return respuesta;
  }) as Page['goto'];
}

// Browser entero: cubre páginas con storageState, contextos nuevos y popups.
// <-loopback> desactiva el bypass implícito de Chromium para localhost.
export const test = base.extend<object, { proxyLocal: string }>({
  // La invitación al recorrido (primer ingreso) es una tarjeta flotante abajo a la derecha: taparía clics de las demás pruebas, que no
  // hablan del onboarding. Se apaga con el interruptor del propio producto; ui-v2-recorrido*.nav.ts lo quita para probarlo.
  context: async ({ context }, usar) => {
    await context.addInitScript(() => { try { localStorage.setItem('likida:onb:desactivado', '1'); } catch { /* sin almacenamiento */ } });
    await usar(context);
  },
  proxyLocal: [async ({}, usar) => {
    const proxy = await crearProxyLocalE2E();
    try { await usar(proxy.server); } finally { await proxy.close(); }
  }, { scope: 'worker' }],
  browser: async ({ playwright, browserName, launchOptions, proxyLocal }, usar) => {
    const browser = await playwright[browserName].launch({
      ...launchOptions, proxy: { server: proxyLocal, bypass: '<-loopback>' },
    });
    // Toda página de todo contexto (el de la prueba y los `browser.newContext()` que abren las pruebas de dueño/encargado)
    // espera el intercambio de streaming después de cada `goto`.
    const nuevoContexto = browser.newContext.bind(browser);
    browser.newContext = (async (...args: Parameters<typeof browser.newContext>) => {
      const ctx = await nuevoContexto(...args);
      ctx.on('page', esperarStreamingTrasGoto);
      return ctx;
    }) as typeof browser.newContext;
    try { await usar(browser); } finally { await browser.close(); }
  },
});
export { expect, request, type Page } from '@playwright/test';
