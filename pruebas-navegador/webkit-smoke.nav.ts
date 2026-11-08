/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMOKE EN WEBKIT / iPhone 14 (F8, CT-CAL-02). NOCTURNO, no por PR: solo corre bajo el proyecto `webkit-iphone` de
 * playwright.config.ts (WEBKIT=1; workflow e2e-webkit-nocturno.yml). El proyecto de PR (Chromium) lo ignora.
 *
 * Cubre lo que iOS rompe y Chromium no: login visible, sesión (cookies SameSite/Secure en WebKit), tablero y lista de viajes sin
 * desborde horizontal y sin excepciones de página. NO cubre VoiceOver (tarea de Javier, fila 72 de TAREAS-JAVIER.md). La captura de
 * viaje por teléfono queda POR CONECTAR: el chofer opera por WhatsApp, no por web (ver movil.nav.ts).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './apoyo/fixture';
import { ESTADOS } from './apoyo/sesion';

async function sinDesborde(page: Page): Promise<void> {
  const d = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth);
  expect(d, 'la página scrollea de lado en iPhone').toBeLessThanOrEqual(1);
}

test('login: pantalla pública con el campo de correo', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await sinDesborde(page);
});

/**
 * POR QUÉ NO `test.use({ storageState })` (diagnóstico del rojo nocturno del 7-nov-2026, run 42384050688):
 * `next start` corre con NODE_ENV=production, y `COOKIES_DE_SESION` (src/lib/supabase/cookies.ts) fuerza `Secure` en producción. El
 * proyecto `preparar` loguea en Chromium, que trata http://localhost como contexto seguro y acepta/envía cookies Secure. WebKit
 * (Playwright en Linux) NO las envía sobre http://localhost: el servidor recibe la petición sin sesión y rebota a /login?next=...
 * En producción (https) el atributo es correcto y se conserva; esto es un desajuste del arnés. Solo se quita `secure` a las cookies
 * de localhost de ESTE contexto de prueba; el resto del estado guardado (valor, dominio, SameSite, httpOnly) queda igual.
 * Se lee en beforeEach (no en `test.use`) porque el archivo lo escribe `preparar` DESPUÉS de que Playwright recolecta las pruebas.
 */
export function cookiesSinSecureEnLocalhost(
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }>,
) {
  return cookies.map((c) => (c.domain === 'localhost' || c.domain === '.localhost' ? { ...c, secure: false } : c));
}

test.describe('con sesión de la dueña', () => {
  test.beforeEach(async ({ context }) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta constante de ESTADOS
    const estado = JSON.parse(readFileSync(ESTADOS.duena, 'utf8')) as { cookies: Parameters<typeof cookiesSinSecureEnLocalhost>[0] };
    expect(estado.cookies.length, 'el estado de la dueña no trae cookies: ¿corrió `preparar`?').toBeGreaterThan(0);
    await context.addCookies(cookiesSinSecureEnLocalhost(estado.cookies));
  });

  for (const ruta of ['/dashboard', '/dashboard/viajes']) {
    test(`${ruta} carga en WebKit sin desborde ni excepciones`, async ({ page }) => {
      const errores: string[] = [];
      page.on('pageerror', (e) => errores.push(e.message));
      await page.goto(ruta);
      await expect(page).toHaveURL(new RegExp(`${ruta}$`));
      await expect(page.locator('body')).toContainText(/Flota Demo|Dueña E2E/);
      await expect(page.locator('[data-nextjs-dialog], .next-error-h1')).toHaveCount(0);
      await sinDesborde(page);
      expect(errores).toEqual([]);
    });
  }
});
