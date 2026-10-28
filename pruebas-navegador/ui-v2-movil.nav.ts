/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHELL v2 EN EL TELÉFONO (Pixel 7, proyecto `movil`; el nombre termina en `movil.nav.ts` para que el playwright.config
 * lo asigne a ese proyecto). Solo con `LIKIDA_UI_V2_FORZAR=1` en el servidor.
 *
 * Contrato: bajo 768 px NO hay aside visible ni riel; hay cabecera sticky de 56 px con el botón «Más», cuya hoja modal
 * (`<dialog>`) trae el árbol completo; Esc la cierra y el foco vuelve al botón.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect } from './apoyo/fixture';
import { ESTADOS } from './apoyo/sesion';

test.skip(process.env.LIKIDA_UI_V2_FORZAR !== '1', 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');
test.use({ storageState: ESTADOS.duena });

test('cabecera de 56 px, sin navegación visible y sin desborde horizontal', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('aside')).toBeHidden();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const cab = await page.locator('.rv-cab-movil').boundingBox();
  expect(cab?.height).toBeGreaterThanOrEqual(56);
  const desborde = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth);
  expect(desborde).toBeLessThanOrEqual(1);
});

test('la hoja «Más» trae el árbol completo, navega y se cierra con Esc devolviendo el foco', async ({ page }) => {
  await page.goto('/dashboard');
  const mas = page.getByRole('button', { name: /Más/ });
  await mas.tap();
  const hoja = page.getByRole('dialog', { name: 'Menú completo' });
  await expect(hoja).toBeVisible();
  await expect(hoja.getByRole('link', { name: 'Viajes', exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(hoja).toBeHidden();
  await expect(mas).toBeFocused();

  await mas.tap();
  await hoja.getByRole('link', { name: 'Viajes', exact: true }).tap();
  await expect(page).toHaveURL(/\/dashboard\/viajes/);
  await expect(hoja).toBeHidden();
});
