/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECORRIDO GUIADO DEL DUEÑO EN ESCRITORIO (adenda 10.1 del plan: «prueba e2e que recorre el tour completo en claro y
 * oscuro y en móvil»; el móvil vive en ui-v2-recorrido-movil.nav.ts). Solo con `LIKIDA_UI_V2_FORZAR=1` en el servidor
 * (segunda pasada de e2e-navegador.yml); sin la variable no hay motor de recorrido (el TourProvider solo se monta en v2).
 *
 * Identidad: el dueño de «Flota E2E Perfil» (tenant_perfil = cinco_agentes, sembrada por sembrar-e2e.mjs), el único con
 * perfil: el recorrido solo se monta con v2 Y perfil. Cada prueba entra con su contexto limpio (localStorage vacío), que es
 * justo la condición de «el sembrado no lo marca como visto»: nada lo abre solo.
 *
 * Qué se afirma (contrato del motor, ui-v2/movimiento/tour/controlador.ts):
 *   · NUNCA se abre solo: la página carga sin globo y ofrece «Ver recorrido»; solo ese botón lo abre.
 *   · «Siguiente» avanza y lleva de página en página (navega por ti); el paso con acción avanza al hacer la acción.
 *   · «Saltar» (y Esc) cierra y recuerda que se omitió: no vuelve a abrirse solo, ni tras recargar.
 *   · «Más tarde» guarda el paso: el botón pasa a «Reanudar recorrido (paso N de M)» y vuelve exactamente a ese paso.
 *   · Claro y oscuro: el globo queda dentro de la ventana y pinta con el fondo de superficie de cada tema.
 * Los pasos se leen de los DATOS del recorrido (RECORRIDO_DUENO): si cambian los pasos, la prueba los sigue.
 *
 * PRESUPUESTO DE CORREOS (apoyo/sesion.ts): 6 logins con su PROPIA IP de origen (x-forwarded-for, llave del límite de
 * /login) para no gastar el techo compartido.
 *
 * NO CORRIDO EN LOCAL al escribirse (exige Docker con la pila de Supabase + build de producción; el de esta Mac choca con
 * otro stack): su primera corrida real es la de CI, y puede necesitar ajustes de localizadores.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { CORREOS, entrar } from './apoyo/sesion';
import { RECORRIDO_DUENO } from '../src/app/dashboard/recorridos/dueno';

test.skip(process.env.LIKIDA_UI_V2_FORZAR !== '1', 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.0.21' }, viewport: { width: 1440, height: 900 } });

const PASOS = RECORRIDO_DUENO.pasos;
const ASISTENTE = '/dashboard/puesta-en-marcha';

const globo = (page: Page) => page.getByRole('region', { name: /Recorrido guiado, paso \d+ de \d+/ });
const lanzador = (page: Page) => page.getByRole('button', { name: /Ver recorrido|Reanudar recorrido/ });
const siguiente = (page: Page) => globo(page).getByRole('button', { name: /^(Siguiente|Terminar)$/ });
const ancla = (page: Page, a: string) => page.locator(`[data-tour="${a}"]`).first();

async function irAlAsistente(page: Page): Promise<void> {
  await page.goto(ASISTENTE);
  await expect(page.getByText('Deja lista tu operación').first()).toBeVisible();
  await expect(lanzador(page)).toBeVisible();
}

/** Qué paso muestra el globo (1-based), leído de su nombre accesible. */
async function numeroDePaso(page: Page): Promise<number> {
  const nombre = (await globo(page).getAttribute('aria-label')) ?? '';
  return Number(/paso (\d+) de/.exec(nombre)?.[1] ?? 0);
}

test.beforeEach(async ({ page }) => {
  await entrar(page, CORREOS.perfilDueno);
  await expect(page).toHaveURL(/\/dashboard/);
});

test('no se abre solo: la página carga sin globo y solo «Ver recorrido» lo abre', async ({ page }) => {
  await irAlAsistente(page);
  await expect(page.locator('[data-ui="v2"]')).toHaveCount(1);
  await expect(globo(page)).toHaveCount(0);
  // Tampoco al cambiar de página dentro del panel.
  await page.goto('/dashboard/conexiones');
  await expect(page).toHaveURL(/\/dashboard\/conexiones/);
  await expect(page.locator('[data-tour="conexiones.estado"]')).toBeVisible();
  await expect(globo(page)).toHaveCount(0);

  await irAlAsistente(page);
  await lanzador(page).click();
  await expect(globo(page)).toBeVisible();
  expect(await numeroDePaso(page)).toBe(1);
  await expect(globo(page).getByRole('heading', { name: PASOS[0].titulo })).toBeVisible();
});

test('recorre todo el recorrido: Siguiente y la acción avanzan, navega de página en página y termina', async ({ page }) => {
  await irAlAsistente(page);
  await lanzador(page).click();
  await expect(globo(page)).toBeVisible();
  const total = Number(/de (\d+)$/.exec((await globo(page).getAttribute('aria-label')) ?? '')?.[1] ?? 0);
  expect(total, 'el globo y los datos del recorrido cuentan los mismos pasos').toBe(PASOS.length);

  for (let i = 0; i < PASOS.length; i++) {
    const paso = PASOS[i];
    await expect(globo(page).getByRole('heading', { name: paso.titulo }), `paso ${i + 1}: ${paso.id}`).toBeVisible();
    expect(await numeroDePaso(page)).toBe(i + 1);
    if (paso.ruta) await expect(page, `paso ${i + 1} (${paso.id}) debe estar en su página`).toHaveURL(new RegExp(`${paso.ruta.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')}(\\?.*)?$`));
    if (paso.ancla) await expect(ancla(page, paso.ancla), `ancla estable ${paso.ancla}`).toBeVisible();

    if (i === PASOS.length - 1) {
      await siguiente(page).click(); // «Terminar»
      await expect(globo(page)).toHaveCount(0);
    } else if (paso.avance?.tipo === 'accion' && paso.ancla) {
      // El paso pide una acción sobre el elemento real: hacerla avanza solo, sin tocar «Siguiente».
      await ancla(page, paso.ancla).click();
    } else {
      await siguiente(page).click();
    }
  }
  // Terminado: el botón vuelve a ofrecer el recorrido completo, no «Reanudar».
  await expect(lanzador(page)).toHaveText(/Ver recorrido/);
});

test('«Atrás» vuelve al paso anterior', async ({ page }) => {
  await irAlAsistente(page);
  await lanzador(page).click();
  await siguiente(page).click();
  await siguiente(page).click();
  await expect.poll(() => numeroDePaso(page)).toBe(3);
  await globo(page).getByRole('button', { name: 'Atrás' }).click();
  await expect.poll(() => numeroDePaso(page)).toBe(2);
});

test('«Saltar» cierra, recuerda que se omitió y no vuelve a abrirse solo (ni con Esc, ni tras recargar)', async ({ page }) => {
  await irAlAsistente(page);
  await lanzador(page).click();
  await siguiente(page).click();
  await expect.poll(() => numeroDePaso(page)).toBe(2);
  await globo(page).getByRole('button', { name: 'Saltar' }).click();
  await expect(globo(page)).toHaveCount(0);

  const guardado = await page.evaluate(() => {
    const clave = Object.keys(localStorage).find((k) => k.startsWith('likida:tour:v1:') && k.endsWith(':dueno'));
    return clave ? JSON.parse(localStorage.getItem(clave) ?? 'null') : null;
  });
  expect(guardado).toMatchObject({ estado: 'omitido' });

  await page.reload();
  await expect(lanzador(page)).toHaveText(/Ver recorrido/);
  await expect(globo(page)).toHaveCount(0);

  // Esc también salta, con el foco en el globo.
  await lanzador(page).click();
  await expect(globo(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(globo(page)).toHaveCount(0);
});

test('«Más tarde» guarda el paso y «Reanudar recorrido» vuelve exactamente a él, también tras recargar', async ({ page }) => {
  await irAlAsistente(page);
  await lanzador(page).click();
  await siguiente(page).click();
  await siguiente(page).click();
  await expect.poll(() => numeroDePaso(page)).toBe(3);
  await globo(page).getByRole('button', { name: 'Más tarde' }).click();
  await expect(globo(page)).toHaveCount(0);

  await expect(lanzador(page)).toHaveText(new RegExp(`Reanudar recorrido \\(paso 3 de ${PASOS.length}\\)`));
  await page.reload();
  await expect(lanzador(page)).toHaveText(new RegExp(`Reanudar recorrido \\(paso 3 de ${PASOS.length}\\)`));
  await lanzador(page).click();
  await expect(globo(page)).toBeVisible();
  expect(await numeroDePaso(page)).toBe(3);
  await expect(globo(page).getByRole('heading', { name: PASOS[2].titulo })).toBeVisible();
});

test('claro y oscuro: el globo se ve completo dentro de la ventana y usa la superficie de cada tema', async ({ page }) => {
  await irAlAsistente(page);
  const fondos: Record<string, string> = {};
  for (const tema of ['light', 'dark'] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await lanzador(page).click();
    await expect(globo(page)).toBeVisible();
    // Un paso con ancla (el 3.º): el globo no puede salirse de la ventana ni quedar sobre el elemento.
    await siguiente(page).click();
    await siguiente(page).click();
    await expect.poll(() => numeroDePaso(page)).toBe(3);
    await globo(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // mide con el globo ya asentado
    const caja = await globo(page).boundingBox();
    const ventana = page.viewportSize()!;
    expect(caja).not.toBeNull();
    expect(caja!.x).toBeGreaterThanOrEqual(0);
    expect(caja!.y).toBeGreaterThanOrEqual(0);
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(ventana.width + 0.5);
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(ventana.height + 0.5);
    fondos[tema] = await globo(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fondos[tema], `fondo del globo en ${tema}`).not.toBe('rgba(0, 0, 0, 0)');
    await globo(page).getByRole('button', { name: 'Saltar' }).click();
    await expect(globo(page)).toHaveCount(0);
    // Cada vuelta empieza limpia: «Ver recorrido» (omitido) reinicia desde el paso 1.
  }
  expect(fondos.light, 'el globo cambia de superficie entre claro y oscuro').not.toBe(fondos.dark);
});
