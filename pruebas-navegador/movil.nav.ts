/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA VISTA MÓVIL — el panel en un teléfono real de catálogo (Pixel 7:
 * 412×915, DPR 2.625, táctil, user-agent móvil; proyecto `movil` del
 * playwright.config, NO una ventana de escritorio encogida).
 *
 * HUECO DECLARADO — LA VISTA DEL CHOFER NO EXISTE COMO WEB. El chofer
 * (rol `operador`) perdió el login web el 7-ago-2026 a propósito: su
 * interfaz es WhatsApp (ver lib/auth/permisos.ts: «su interfaz es WhatsApp,
 * no exporta nada desde la web», e invitar.ts, que rebota el rol). No se
 * escribe aquí una prueba que finja probarla. Lo que SÍ existe en un
 * teléfono — y aquí se prueba — es el panel del dueño/encargado, que
 * despacha desde la cabina o el patio con el celular. La conversación del
 * chofer se prueba donde vive: los arneses de WhatsApp.
 *
 * Otro hueco declarado: solo Chromium (el navegador del andamio del smoke);
 * la vista iOS/WebKit no está cubierta.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { ESTADOS } from './apoyo/sesion';
import { filtroEstado } from './apoyo/viajes';
import { abrirNavegacion } from './apoyo/navegacion';

test.use({ storageState: ESTADOS.duena });

/** El ítem «Viajes» del menú: v1 apunta al registro; v2, al grupo Despacho (el registro es una de sus pestañas). */
const VIAJES = 'a[href^="/dashboard/viajes"], a[href^="/dashboard/despacho"]';

/** La página entera no debe scrollear de lado: lo ancho (tablas) scrollea
 *  dentro de su propio contenedor. Un desborde horizontal en móvil es la
 *  pantalla rota clásica que el escritorio nunca enseña. */
async function sinDesbordeHorizontal(page: Page): Promise<void> {
  const desborde = await page.evaluate(() => {
    const raiz = document.scrollingElement ?? document.documentElement;
    return raiz.scrollWidth - window.innerWidth;
  });
  expect(desborde, 'la página scrollea horizontal en un viewport de teléfono').toBeLessThanOrEqual(1);
}

test('el resumen carga en el teléfono sin desborde y con la navegación a mano', async ({ page }) => {
  await page.goto('/dashboard');
  // v1: el aside de íconos; v2: la hoja «Más». El ayudante devuelve el contenedor donde está el menú en cada caso.
  const nav = await abrirNavegacion(page);
  await expect(nav.locator(VIAJES).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await sinDesbordeHorizontal(page);
});

test('del resumen al registro navegando con el dedo, y la tabla es legible', async ({ page }) => {
  await page.goto('/dashboard');
  // El rail de navegación colapsa a íconos bajo `lg` (MARCO_SIDEBAR): el
  // destino se toca, no se lee — como lo haría el pulgar.
  const nav = await abrirNavegacion(page);
  // v1 trae un enlace directo al registro (además de Despacho): se prefiere ese. v2 solo trae la entrada «Viajes» → Despacho.
  const registroDirecto = nav.locator('a[href^="/dashboard/viajes"]');
  await ((await registroDirecto.count()) ? registroDirecto.first() : nav.locator(VIAJES).first()).tap();
  // Se espera a que la navegación termine ANTES de decidir el camino (si no, se lee la URL del Resumen todavía).
  await page.waitForURL(/\/dashboard\/(viajes|despacho)/);
  // v2: «Viajes» abre el grupo Despacho y el registro es su pestaña «Registro»; v1 lleva directo al registro.
  if (!/\/dashboard\/viajes/.test(page.url())) {
    await expect(page).toHaveURL(/\/dashboard\/despacho/);
    // v2 trae la barra de pestañas «Secciones de Viajes»; v1 (flotas sembradas en v1 en la pasada normal) no la tiene y el
    // registro se alcanza con su propio enlace. En los dos casos se llega tocando, como el pulgar.
    const pestanas = page.getByRole('navigation', { name: 'Secciones de Viajes' });
    if (await pestanas.count()) {
      await pestanas.getByRole('link', { name: 'Registro', exact: true }).tap();
    } else {
      await page.locator('a[href="/dashboard/viajes"]:visible').first().tap();
    }
  }
  await expect(page).toHaveURL(/\/dashboard\/viajes/);
  await expect(page.locator('body')).toContainText('VJ-2026-0001');
  await sinDesbordeHorizontal(page);
});

test('los filtros del registro también funcionan a dedo', async ({ page }) => {
  await page.goto('/dashboard/viajes');
  await filtroEstado(page, 'Liquidados').tap();
  await expect(page).toHaveURL(/f=liquidados/);
  await expect(page.locator('body')).toContainText('VJ-2026-0844');
  await expect(page.locator('body')).not.toContainText('VJ-2026-0001');
  await sinDesbordeHorizontal(page);
});
