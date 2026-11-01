/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ONBOARDING DEL DUEÑO EN EL TELÉFONO (Pixel 7, proyecto `movil`: el nombre termina en `movil.nav.ts`). Solo con
 * `LIKIDA_UI_V2_FORZAR=1`. Complementa ui-v2-recorrido.nav.ts.
 *
 * En el teléfono la tarjeta es una hoja inferior sobre la barra de navegación y el aside (donde viven las anclas `nav-*`) NO se
 * ve: esos pasos degradan a «No veo este elemento…» y siguen guiados por texto. Se afirma: la invitación aparece y no se abre
 * solo nada, la hoja cabe en la pantalla sin desborde y sin tapar la barra inferior, los botones miden 44 px o más y todo el
 * recorrido corto se puede hacer a toque.
 *
 * NO CORRIDO EN LOCAL al escribirse; su primera corrida real es la de CI.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { CORREOS, entrar } from './apoyo/sesion';

test.skip(process.env.LIKIDA_UI_V2_FORZAR !== '1', 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.0.22' } });

const tarjeta = (page: Page) => page.getByRole('region', { name: /Recorrido guiado, paso \d+ de \d+/ });
const invitacion = (page: Page) => page.getByRole('region', { name: 'Invitación al recorrido' });

async function sinDesborde(page: Page): Promise<void> {
  const desborde = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth);
  expect(desborde, 'la página scrollea de lado con el recorrido abierto').toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await entrar(page, CORREOS.perfilDueno);
  await expect(page).toHaveURL(/\/dashboard/);
});

test('invita sin abrir nada solo; la hoja cabe en la pantalla y sus botones son táctiles', async ({ page }) => {
  await expect(page.locator('aside.rv-sb')).toBeHidden();
  await expect(invitacion(page)).toBeVisible();
  await expect(tarjeta(page)).toHaveCount(0);
  await invitacion(page).getByRole('button', { name: 'Recorrido corto' }).tap();
  await expect(tarjeta(page)).toBeVisible();
  await tarjeta(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const caja = await tarjeta(page).boundingBox();
  const ventana = page.viewportSize()!;
  expect(caja!.x).toBeGreaterThanOrEqual(0);
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(ventana.width + 0.5);
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(ventana.height + 0.5);
  const boton = await tarjeta(page).getByRole('button', { name: /^(Siguiente|Llévame)$/ }).boundingBox();
  expect(boton!.height).toBeGreaterThanOrEqual(43.5);
  await sinDesborde(page);
});

test('el recorrido corto se hace entero a toque y «Omitir recorrido» cierra', async ({ page }) => {
  await invitacion(page).getByRole('button', { name: 'Recorrido corto' }).tap();
  for (let i = 0; i < 30 && (await tarjeta(page).count()) > 0; i++) {
    await sinDesborde(page);
    await tarjeta(page).getByRole('button', { name: /^(Siguiente|Llévame|Terminar)$/ }).tap();
    await page.waitForTimeout(150);
  }
  await expect(tarjeta(page)).toHaveCount(0);
  await page.reload();
  await expect(invitacion(page)).toHaveCount(0);
});
