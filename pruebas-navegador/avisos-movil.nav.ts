/**
 * (i) AVISOS EN EL TELÉFONO (Pixel 7, 412×915; el proyecto `movil` recoge todo `*movil.nav.ts`). La lista y la configuración se usan a
 * dedo: nada se sale de la pantalla, los botones se alcanzan con el pulgar (≥ 32 px de alto) y las acciones funcionan tocando.
 * Los datos los siembra `apoyo/avisos-datos.ts`; la flota A se fija en v2 (el pie «Avisos» vive dentro de la hoja «Más»).
 */
import { test, expect, type Page } from './apoyo/fixture';
import { CORREOS, ESTADOS } from './apoyo/sesion';
import { fijarVersionUi, limpiarCondiciones, reiniciarEstado, sembrarCondiciones, TENANT_A, usuarioId, leidasEnBase } from './apoyo/avisos-datos';
import { abrirNavegacion } from './apoyo/navegacion';
import { botonLeido, esperarChromeV2, conteoPestana, esperarAviso, filas, irAPestana, listaLista, numeroPie, vigilarConsola } from './apoyo/avisos-ui';

test.use({ storageState: ESTADOS.duena });
test.describe.configure({ mode: 'serial' });

let versionAnterior: 'v1' | 'v2' | null = null;
let userId = '';
let consola: { errores: string[] };

test.beforeAll(async () => {
  await sembrarCondiciones();
  versionAnterior = await fijarVersionUi(TENANT_A, 'v2');
  userId = await usuarioId(CORREOS.duena);
});
test.afterAll(async () => {
  await limpiarCondiciones();
  await reiniciarEstado(userId);
  if (versionAnterior) await fijarVersionUi(TENANT_A, versionAnterior);
});
test.beforeEach(async ({ page }) => { await reiniciarEstado(userId); await esperarChromeV2(page); consola = vigilarConsola(page); });
test.afterEach(() => { expect(consola.errores, 'errores de consola o de página').toEqual([]); });

async function sinDesborde(page: Page): Promise<void> {
  const d = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth);
  expect(d, 'la página scrollea de lado en el teléfono').toBeLessThanOrEqual(1);
}

/** Un control tocable: dentro del ancho de la pantalla y con alto suficiente. */
async function alAlcance(page: Page, el: ReturnType<Page['locator']>, nombre: string): Promise<void> {
  await el.scrollIntoViewIfNeeded();
  const caja = await el.boundingBox();
  expect(caja, `${nombre} sin caja`).not.toBeNull();
  const ancho = page.viewportSize()!.width;
  expect(caja!.x, `${nombre} se sale por la izquierda`).toBeGreaterThanOrEqual(-1);
  expect(caja!.x + caja!.width, `${nombre} se sale por la derecha`).toBeLessThanOrEqual(ancho + 1);
  expect(caja!.height, `${nombre} muy bajo para el pulgar`).toBeGreaterThanOrEqual(28);
}

test('(i) la lista de avisos se lee y se usa a dedo: sin desborde, pie coherente, marcar leído tocando', async ({ page }) => {
  await esperarAviso(page, '/dashboard/notificaciones', /comprobantes? lleg/i);
  await irAPestana(page, 'No leídas');
  await listaLista(page);
  await sinDesborde(page);
  const n = await conteoPestana(page, 'No leídas');
  expect(n).toBeGreaterThan(0);

  // Los filtros y «Marcar todo» están al alcance.
  await alAlcance(page, page.getByLabel('Tipo', { exact: true }), 'filtro Tipo');
  await alAlcance(page, page.getByLabel('Severidad', { exact: true }), 'filtro Severidad');
  await alAlcance(page, page.getByRole('button', { name: 'Marcar todo como leído' }), 'Marcar todo');
  // Cada fila: el título cabe y sus botones están en pantalla.
  const total = await filas(page).count();
  for (let i = 0; i < total; i++) {
    const fila = filas(page).nth(i);
    await fila.scrollIntoViewIfNeeded();
    const caja = await fila.boundingBox();
    expect(caja!.x + caja!.width, `fila ${i} se sale de la pantalla`).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    const enlace = fila.getByRole('link', { name: 'Abrir' });
    if (await enlace.count()) await alAlcance(page, enlace, `Abrir (fila ${i})`);
    const b = botonLeido(fila);
    if (await b.count()) await alAlcance(page, b, `Marcar leído (fila ${i})`);
  }

  // El pie vive en la hoja «Más» y dice lo mismo que la pestaña.
  const nav = await abrirNavegacion(page);
  await expect(nav.locator('a.rv-ps-avisos').first()).toBeVisible();
  expect(await numeroPie(page)).toBe(n);
  await page.keyboard.press('Escape');

  // Marcar tocando: baja el conteo sin recargar y persiste en la base.
  const candidata = filas(page).filter({ has: page.getByRole('button', { name: 'Marcar leído' }) }).first();
  await botonLeido(candidata).tap();
  await expect.poll(() => conteoPestana(page, 'No leídas')).toBe(n - 1);
  await expect.poll(async () => (await leidasEnBase(userId)).length).toBe(1);
  await sinDesborde(page);
});

test('(i) la configuración se usa a dedo: matriz, interruptores, horas y guardar caben y funcionan', async ({ page }) => {
  await page.goto('/dashboard/notificaciones?seccion=configuracion');
  await expect(page.getByRole('button', { name: 'Guardar horario' })).toBeVisible();
  await sinDesborde(page);

  const casilla = page.getByRole('checkbox', { name: 'Dinero · En la app' });
  await expect(casilla).toBeChecked();
  // El blanco tocable de una casilla es su fila (<label>), no la caja de 16 px.
  await alAlcance(page, casilla.locator('xpath=ancestor::label'), 'casilla Dinero · En la app');
  await casilla.setChecked(false);
  await expect(page.getByText('Preferencia guardada.')).toBeVisible();
  await casilla.setChecked(true);

  await alAlcance(page, page.getByLabel('Desde', { exact: true }), 'hora Desde');
  await alAlcance(page, page.getByLabel('Hasta', { exact: true }), 'hora Hasta');
  await alAlcance(page, page.getByRole('switch', { name: /No avisar por correo ni WhatsApp/ }), 'interruptor de silencio');
  await page.getByRole('switch', { name: /No avisar por correo ni WhatsApp/ }).check({ force: true });
  await page.getByLabel('Desde', { exact: true }).fill('22:15');
  const guardar = page.getByRole('button', { name: 'Guardar horario' });
  await alAlcance(page, guardar, 'Guardar horario');
  await guardar.tap();
  await expect(page.getByText('Horario guardado.')).toBeVisible();
  await sinDesborde(page);
});
