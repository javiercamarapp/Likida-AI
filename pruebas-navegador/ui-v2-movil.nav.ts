/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHELL v2 EN EL TELÉFONO (Pixel 7, proyecto `movil`; el nombre termina en `movil.nav.ts` para que el playwright.config
 * lo asigne a ese proyecto). Solo con `LIKIDA_UI_V2_FORZAR=1` en el servidor.
 *
 * Contrato: bajo 768 px NO hay aside visible ni riel; hay cabecera sticky de 56 px (logo, Guía, campana) y la barra inferior
 * flotante de 64 px (hasta 4 destinos del rol + «Más»), cuya hoja modal (`<dialog>`) trae el árbol completo; Esc la cierra y el
 * foco vuelve al botón «Más» de la barra.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect } from './apoyo/fixture';
import { ESTADOS } from './apoyo/sesion';

test.skip(process.env.LIKIDA_UI_V2_FORZAR !== '1', 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');
test.use({ storageState: ESTADOS.duena });

test('cabecera de 56 px, sin navegación visible y sin desborde horizontal', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('aside')).toBeHidden();
  // Una sola navegación visible: la barra inferior (el aside y su <nav> están en display:none).
  await expect(page.getByRole('navigation')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Navegación móvil' })).toBeVisible();
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

test('la barra inferior: píldora de 64 px dentro de la ventana, 44 px de toque, destino activo y safe-area', async ({ page }) => {
  await page.goto('/dashboard');
  const barra = page.getByRole('navigation', { name: 'Navegación móvil' });
  const caja = await barra.boundingBox();
  const vp = page.viewportSize();
  expect(caja?.height).toBeGreaterThanOrEqual(64);
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(vp!.height);
  expect(caja!.x).toBeGreaterThanOrEqual(0);
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(vp!.width);
  const destinos = barra.locator('a, button');
  const n = await destinos.count();
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(5);
  for (let i = 0; i < n; i++) {
    const c = await destinos.nth(i).boundingBox();
    expect(c?.height, `destino ${i}`).toBeGreaterThanOrEqual(44);
    expect(c?.width, `destino ${i}`).toBeGreaterThanOrEqual(44);
  }
  await expect(barra.locator('[aria-current="page"]')).toHaveCount(1);
  // El contenido no queda tapado: el final de la página deja sitio a la barra.
  const hueco = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rv-contenido')!).paddingBottom));
  expect(hueco).toBeGreaterThanOrEqual(64 + 10 + 24);
});
