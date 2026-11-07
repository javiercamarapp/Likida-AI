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

test.describe('con sesión de la dueña', () => {
  test.use({ storageState: ESTADOS.duena });

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
