import { test as base } from '@playwright/test';
import { crearProxyLocalE2E } from '../../scripts/ci/e2e/proxy-local.mjs';

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
    try { await usar(browser); } finally { await browser.close(); }
  },
});
export { expect, request, type Page } from '@playwright/test';
