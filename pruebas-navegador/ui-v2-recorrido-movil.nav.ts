/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECORRIDO GUIADO DEL DUEÑO EN EL TELÉFONO (Pixel 7, proyecto `movil`: el nombre termina en `movil.nav.ts` para que el
 * playwright.config lo asigne a ese proyecto). Solo con `LIKIDA_UI_V2_FORZAR=1`. Complementa ui-v2-recorrido.nav.ts.
 *
 * En el teléfono el globo es una hoja inferior y el aside (donde viven las anclas `nav-*`) NO se ve: esos pasos degradan a
 * «No vemos ese elemento…» y siguen guiados por texto. Lo que se afirma: no se abre solo, se abre con «Ver recorrido», la
 * hoja cabe en 412 px sin desborde horizontal, todos los pasos se pueden recorrer a toque con «Siguiente» (incluidos los
 * de ancla oculta) y «Saltar» cierra.
 *
 * NO CORRIDO EN LOCAL al escribirse; su primera corrida real es la de CI (misma advertencia que ui-v2-recorrido.nav.ts).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { CORREOS, entrar } from './apoyo/sesion';
import { RECORRIDO_DUENO } from '../src/app/dashboard/recorridos/dueno';

test.skip(process.env.LIKIDA_UI_V2_FORZAR !== '1', 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.0.22' } });

const PASOS = RECORRIDO_DUENO.pasos;
const globo = (page: Page) => page.getByRole('region', { name: /Recorrido guiado, paso \d+ de \d+/ });
const lanzador = (page: Page) => page.getByRole('button', { name: /Ver recorrido|Reanudar recorrido/ });

async function sinDesborde(page: Page): Promise<void> {
  const desborde = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth);
  expect(desborde, 'la página scrollea de lado con el recorrido abierto').toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await entrar(page, CORREOS.perfilDueno);
  await page.goto('/dashboard/puesta-en-marcha');
  await expect(lanzador(page)).toBeVisible();
});

test('no se abre solo; «Ver recorrido» abre una hoja que cabe en la pantalla', async ({ page }) => {
  await expect(page.locator('aside.rv-sb')).toBeHidden();
  await expect(globo(page)).toHaveCount(0);
  await lanzador(page).tap();
  await expect(globo(page)).toBeVisible();
  const caja = await globo(page).boundingBox();
  const ventana = page.viewportSize()!;
  expect(caja!.x).toBeGreaterThanOrEqual(0);
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(ventana.width + 0.5);
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(ventana.height + 0.5);
  await sinDesborde(page);
});

test('se recorre entero a toque con «Siguiente» (los pasos de ancla oculta degradan a texto) y termina', async ({ page }) => {
  await lanzador(page).tap();
  for (let i = 0; i < PASOS.length; i++) {
    await expect(globo(page).getByRole('heading', { name: PASOS[i].titulo }), `paso ${i + 1}: ${PASOS[i].id}`).toBeVisible();
    await sinDesborde(page);
    await globo(page).getByRole('button', { name: i === PASOS.length - 1 ? 'Terminar' : 'Siguiente' }).tap();
  }
  await expect(globo(page)).toHaveCount(0);
});

test('«Saltar» cierra y el recorrido no vuelve solo', async ({ page }) => {
  await lanzador(page).tap();
  await expect(globo(page)).toBeVisible();
  await globo(page).getByRole('button', { name: 'Saltar' }).tap();
  await expect(globo(page)).toHaveCount(0);
  await page.reload();
  await expect(lanzador(page)).toHaveText(/Ver recorrido/);
  await expect(globo(page)).toHaveCount(0);
});
