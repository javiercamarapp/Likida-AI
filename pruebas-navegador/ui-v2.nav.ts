/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHELL v2 EN ESCRITORIO (Fase 1, carril A). Solo tiene sentido cuando el servidor corre con `LIKIDA_UI_V2_FORZAR=1`
 * (segunda pasada del workflow e2e-navegador.yml); sin la variable, la primera prueba comprueba lo contrario: que v1 NO
 * trae `data-ui`. Identidad: la dueña de la flota SIN perfil (menú genérico), para no gastar otro login.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect } from './apoyo/fixture';
import { ESTADOS } from './apoyo/sesion';

const V2 = process.env.LIKIDA_UI_V2_FORZAR === '1';

test.use({ storageState: ESTADOS.duena });

test('el chrome sigue a la bandera: v2 con data-ui, v1 sin él', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('[data-ui="v2"]')).toHaveCount(V2 ? 1 : 0);
});

test.describe('con la UI v2 forzada', () => {
  test.skip(!V2, 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');

  test('una sola navegación visible, aria-current en el ítem activo y salto al contenido', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard/viajes');
    await expect(page.getByRole('navigation')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    const activo = page.locator('aside a[aria-current="page"]');
    await expect(activo).toHaveCount(1);
    await expect(activo).toHaveAttribute('href', /^\/dashboard\/viajes/);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
    await expect(page.locator('#contenido-principal')).toBeVisible();
  });

  test('tableta (768–1023 px): riel de 72 px, sin enlaces duplicados y con el nombre accesible intacto', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/dashboard/viajes');
    const caja = await page.locator('aside').boundingBox();
    expect(caja?.width).toBe(72);
    await expect(page.getByRole('navigation').locator('a[href="/dashboard/viajes"]')).toHaveCount(1);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Viajes', exact: true })).toBeVisible();
  });

  test('escritorio (≥1024 px): sidebar de 232 px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dashboard/viajes');
    expect((await page.locator('aside').boundingBox())?.width).toBe(232);
  });

  test('pie del sidebar: UN solo bloque (≤ 100 px) con la tarjeta de cuenta; Guía y Notificaciones en la topbar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard/viajes');
    const pie = await page.locator('.rv-sb__pie').boundingBox();
    expect(pie?.height).toBeLessThanOrEqual(100);
    await expect(page.locator('.rv-sb__pie [role="radiogroup"]')).toHaveCount(0); // el tema vive en el menú de la tarjeta
    await expect(page.locator('.rv-sb__pie .rv-contador')).toHaveCount(0); // sin contador de avisos en el pie
    const topbar = page.locator('header.rv-cab-esc');
    await expect(topbar.getByRole('button', { name: 'Guía' })).toBeVisible();
    await expect(topbar.getByRole('link', { name: /Notificaciones/ })).toBeVisible();
    await expect(page.locator('.rv-migas')).toHaveCount(0);
    await topbar.getByRole('button', { name: 'Guía' }).click();
    await expect(page.getByRole('menu', { name: 'Guía' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Guía' })).toBeHidden();
  });

  test('el riel se anima: al plegar el sidebar el ancho pasa a 72 px y el chevron gira (movimiento permitido)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard/viajes');
    expect((await page.locator('aside').boundingBox())?.width).toBe(232);
    await page.getByRole('button', { name: 'Plegar el menú' }).first().click();
    await expect.poll(async () => (await page.locator('aside').boundingBox())?.width, { timeout: 3000 }).toBe(72);
    await expect(page.locator('.rv-cab-esc__plegar')).toHaveAttribute('aria-expanded', 'false');
    // Todos los destinos siguen alcanzables en el riel (el texto se oculta de forma visual, el enlace y su nombre accesible quedan).
    await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Viajes', exact: true })).toHaveCount(1);
  });

  test('modo oscuro: el documento (body) también es oscuro, no solo el div del chrome', async ({ page }) => {
    await page.goto('/dashboard/viajes');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    // `body` transiciona el fondo al cambiar de tema: leer el estilo justo después de poner data-theme da un color a medio
    // camino (prueba intermitente). `expect.poll` reintenta hasta que la transición termina; no se debilita lo que se mide:
    // el valor final sigue siendo el negro neutro #0e0e10 de la paleta (ESTILO-LIKIDA §1).
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor), { timeout: 5000 }).toBe('rgb(14, 14, 16)');
  });
});
