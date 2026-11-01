/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ONBOARDING DEL DUEÑO EN ESCRITORIO (lote O). Solo con `LIKIDA_UI_V2_FORZAR=1` en el servidor (segunda pasada de
 * e2e-navegador.yml). Identidad: el dueño de «Flota E2E Perfil» (cinco_agentes, sembrada por sembrar-e2e.mjs). Cada prueba
 * entra con el contexto limpio (localStorage vacío) = «primer ingreso».
 *
 * Qué se afirma:
 *   · Primer ingreso: aparece la INVITACIÓN (corto / completo / ahora no) y NO se abre ningún recorrido solo.
 *   · «Recorrido corto» abre la tarjeta (región «Recorrido guiado, paso n de N»), sin atrapar el foco ni bloquear la página.
 *   · Se recorre hasta el final con «Llévame» / «Siguiente» / «Terminar», navegando de pantalla en pantalla.
 *   · Esc cierra y conserva el paso; el menú Guía ofrece «Retomar donde lo dejé» y vuelve a ese paso.
 *   · «Omitir recorrido» guarda que se omitió: la invitación no vuelve, ni tras recargar.
 *   · El menú Guía lista las pantallas del rol («Saltar a una pantalla») y un recorrido por agente.
 *   · Claro y oscuro: la tarjeta queda dentro de la ventana y cambia de superficie con el tema.
 *
 * PRESUPUESTO DE CORREOS (apoyo/sesion.ts): cada prueba con su PROPIA IP de origen no es necesaria aquí (6 logins como máximo).
 * NO CORRIDO EN LOCAL al escribirse (exige Docker con la pila de Supabase + build de producción): su primera corrida real es la
 * de CI y puede necesitar ajustes de localizadores.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { CORREOS, entrar } from './apoyo/sesion';

test.skip(process.env.LIKIDA_UI_V2_FORZAR !== '1', 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.0.21' }, viewport: { width: 1440, height: 900 } });

const tarjeta = (page: Page) => page.getByRole('region', { name: /Recorrido guiado, paso \d+ de \d+/ });
const invitacion = (page: Page) => page.getByRole('region', { name: 'Invitación al recorrido' });
const guia = (page: Page) => page.locator('[data-onboarding="recorrido.boton"]').first();
const avanzar = (page: Page) => tarjeta(page).getByRole('button', { name: /^(Siguiente|Llévame|Terminar)$/ });

async function numeroDePaso(page: Page): Promise<number> {
  const nombre = (await tarjeta(page).getAttribute('aria-label')) ?? '';
  return Number(/paso (\d+) de/.exec(nombre)?.[1] ?? 0);
}

test.beforeEach(async ({ page }) => {
  await entrar(page, CORREOS.perfilDueno);
  await expect(page).toHaveURL(/\/dashboard/);
});

test('primer ingreso: invita, no abre solo, y «Recorrido corto» abre la tarjeta sin bloquear la página', async ({ page }) => {
  await expect(invitacion(page)).toBeVisible();
  await expect(tarjeta(page)).toHaveCount(0);
  await invitacion(page).getByRole('button', { name: 'Recorrido corto' }).click();
  await expect(tarjeta(page)).toBeVisible();
  expect(await numeroDePaso(page)).toBe(1);
  // La página sigue operable: el menú recibe clics con la tarjeta abierta (la capa no los captura).
  await page.locator('[data-tour="nav-viajes"]').first().click({ trial: true });
});

test('el recorrido corto se recorre hasta el final y deja «terminado»', async ({ page }) => {
  await invitacion(page).getByRole('button', { name: 'Recorrido corto' }).click();
  await expect(tarjeta(page)).toBeVisible();
  const total = Number(/de (\d+)$/.exec((await tarjeta(page).getAttribute('aria-label')) ?? '')?.[1] ?? 0);
  expect(total).toBeGreaterThanOrEqual(10);
  for (let i = 0; i < total + 15 && (await tarjeta(page).count()) > 0; i++) {
    await avanzar(page).click();
    await page.waitForTimeout(150);
  }
  await expect(tarjeta(page)).toHaveCount(0);
  const guardado = await page.evaluate(() => {
    const clave = Object.keys(localStorage).find((k) => k.startsWith('likida:tour:v1:') && k.endsWith(':dueno.corto'));
    return clave ? JSON.parse(localStorage.getItem(clave) ?? 'null') : null;
  });
  expect(guardado).toMatchObject({ estado: 'terminado' });
});

test('Esc cierra conservando el paso y la Guía ofrece «Retomar donde lo dejé»', async ({ page }) => {
  await invitacion(page).getByRole('button', { name: 'Recorrido completo' }).click();
  await avanzar(page).click();
  await avanzar(page).click();
  await expect.poll(() => numeroDePaso(page)).toBeGreaterThanOrEqual(2);
  const paso = await numeroDePaso(page);
  await page.keyboard.press('Escape');
  await expect(tarjeta(page)).toHaveCount(0);
  await guia(page).click();
  await page.getByRole('menuitem', { name: /Retomar donde lo dejé/ }).click();
  await expect(tarjeta(page)).toBeVisible();
  expect(await numeroDePaso(page)).toBe(paso);
});

test('«Omitir recorrido» recuerda que se omitió: la invitación no vuelve, ni tras recargar', async ({ page }) => {
  await invitacion(page).getByRole('button', { name: 'Recorrido corto' }).click();
  await tarjeta(page).getByRole('button', { name: 'Omitir recorrido' }).click();
  await expect(tarjeta(page)).toHaveCount(0);
  await page.reload();
  await expect(invitacion(page)).toHaveCount(0);
  await expect(tarjeta(page)).toHaveCount(0);
});

test('el menú Guía ofrece las pantallas del rol y un recorrido por agente', async ({ page }) => {
  await invitacion(page).getByRole('button', { name: 'Ahora no' }).click();
  await guia(page).click();
  await expect(page.getByRole('menuitem', { name: 'Recorrido corto' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Recorrido completo' })).toBeVisible();
  await expect(page.getByText('Saltar a una pantalla')).toBeVisible();
  await expect(page.getByText('Recorrido por agente')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Primeros pasos' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Operadores' }).click();
  await expect(tarjeta(page)).toBeVisible();
});

test('claro y oscuro: la tarjeta queda dentro de la ventana y cambia de superficie con el tema', async ({ page }) => {
  await invitacion(page).getByRole('button', { name: 'Ahora no' }).click();
  const fondos: Record<string, string> = {};
  for (const tema of ['light', 'dark'] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await guia(page).click();
    await page.getByRole('menuitem', { name: 'Recorrido corto' }).click();
    await expect(tarjeta(page)).toBeVisible();
    await tarjeta(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const caja = await tarjeta(page).boundingBox();
    const ventana = page.viewportSize()!;
    expect(caja!.x).toBeGreaterThanOrEqual(0);
    expect(caja!.y).toBeGreaterThanOrEqual(0);
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(ventana.width + 0.5);
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(ventana.height + 0.5);
    fondos[tema] = await tarjeta(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    await tarjeta(page).getByRole('button', { name: 'Omitir recorrido' }).click();
  }
  expect(fondos.light).not.toBe(fondos.dark);
});
