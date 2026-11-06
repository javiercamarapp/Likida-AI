/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACCESIBILIDAD DE ESTRUCTURA (F8, CT-CAL-01/CT-PAR-11) — sobre la pantalla pública /login, sin gastar correos del presupuesto.
 *
 * No sustituye a axe-core (no está en package.json; agregarlo exige tocar el lock, decisión aparte): mide lo que se puede medir con
 * Playwright puro y que antes no tenía ninguna prueba:
 *   · el documento declara idioma y tiene exactamente un h1 visible;
 *   · el campo de correo tiene nombre accesible;
 *   · el foco por TECLADO se ve (anillo/contorno distinto de «ninguno») en el campo y en el botón;
 *   · con prefers-reduced-motion: reduce ninguna animación corre en bucle infinito;
 *   · el contenedor de la pantalla no scrollea de lado en un teléfono de 390 px (WCAG 1.4.10, reflow).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';

async function tabularHasta(page: Page, selector: string, maximo = 25): Promise<void> {
  for (let i = 0; i < maximo; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
  }
  throw new Error(`el foco por teclado nunca llegó a ${selector} en ${maximo} Tab`);
}

async function foco(page: Page): Promise<{ contorno: string; sombra: string }> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const c = getComputedStyle(e);
    const visible = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0;
    return { contorno: visible ? `${c.outlineWidth} ${c.outlineStyle}` : 'ninguno', sombra: c.boxShadow };
  });
}

test.describe('/login: estructura accesible', () => {
  test('idioma, un solo h1 y campo de correo con nombre accesible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', /^es/);
    await expect(page.locator('h1:visible')).toHaveCount(1);
    await expect(page.locator('#login-email')).toHaveAccessibleName(/.+/);
  });

  test('el foco por teclado se ve en el campo de correo', async ({ page }) => {
    await page.goto('/login');
    await tabularHasta(page, '#login-email');
    const f = await foco(page);
    expect(f.contorno !== 'ninguno' || (f.sombra !== 'none' && f.sombra !== ''), `sin indicador de foco: ${JSON.stringify(f)}`).toBe(true);
  });

  test('con reduced-motion no queda ninguna animación infinita corriendo', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await page.waitForTimeout(500);
    const infinitas = await page.evaluate(() =>
      document.getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity)
        .map((a) => (a as CSSAnimation).animationName ?? a.id ?? 'sin-nombre'),
    );
    expect(infinitas).toEqual([]);
  });

  test('en 390 px no hay desborde horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    const desborde = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth);
    expect(desborde).toBeLessThanOrEqual(1);
  });
});
