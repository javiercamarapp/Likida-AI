/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA INVITACIÓN AL RECORRIDO, ENCENDIDA (`ONBOARDING_INVITACION=1` en el servidor de la segunda pasada), en el DOM REAL (sin arnés)
 * y por rol: dueño, encargado, contador y nómina de «Flota E2E Perfil». A diferencia de las demás pruebas, aquí NO se apaga con el
 * interruptor del navegador. Se afirma:
 *   · la invitación sale con la piel v2: vive dentro de un contenedor `data-ui="v2"` con el z-index del recorrido (55), su botón
 *     primario es NEGRO (--marca) y nada es naranja de v1;
 *   · no queda bajo las cabeceras sticky (el punto central de la tarjeta le pertenece) y no es modal (la página sigue operable);
 *   · si la persona se va a otra pantalla, la ignoró: se cierra y NO tapa las acciones de la otra pantalla;
 *   · se anuncia (región con nombre y `role="status"`).
 * NO CORRIDO EN LOCAL al escribirse: su primera corrida real es la de CI.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { CORREOS, entrar } from './apoyo/sesion';

test.skip(process.env.LIKIDA_UI_V2_FORZAR !== '1', 'solo corre con LIKIDA_UI_V2_FORZAR=1 en el servidor');

const ROLES = [
  { nombre: 'dueño', correo: CORREOS.perfilDueno, ip: '10.77.0.31', destino: 'aside a[href="/dashboard/viajes"]' },
  { nombre: 'encargado', correo: CORREOS.perfilEncargado, ip: '10.77.0.32', destino: 'aside a[href="/dashboard/viajes"]' },
  { nombre: 'contador', correo: CORREOS.perfilContador, ip: '10.77.0.33', destino: 'aside a[href="/dashboard/agentes/peajes"]' },
  { nombre: 'nómina', correo: CORREOS.perfilNomina, ip: '10.77.0.34', destino: '[data-tour="nav-notificaciones"]' },
] as const;

const invitacion = (page: Page) => page.getByRole('region', { name: 'Invitación al recorrido' });

for (const rol of ROLES) {
  test(`${rol.nombre}: invitación con piel v2, anunciada, sin tapar otras pantallas`, async ({ browser }) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': rol.ip }, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await entrar(page, rol.correo);
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(invitacion(page)).toBeVisible();

      const medidas = await invitacion(page).evaluate((el) => {
        const contenedor = el.closest('[data-ui="v2"]') as HTMLElement | null;
        const primario = el.querySelector('[data-onb-primario]') as HTMLElement;
        return {
          dentroDeV2: Boolean(contenedor),
          z: contenedor ? getComputedStyle(contenedor).zIndex : null,
          fondoPrimario: getComputedStyle(primario).backgroundColor,
          anuncia: Boolean(el.querySelector('[role="status"]')),
        };
      });
      expect(medidas.dentroDeV2, 'la invitación debe vivir dentro de data-ui="v2"').toBe(true);
      expect(medidas.z).toBe('55');
      expect(medidas.fondoPrimario, 'primario negro (--marca), nunca el naranja de v1').toBe('rgb(14, 14, 16)');
      // Nada la tapa (cabeceras sticky, otras capas): Playwright falla el clic de prueba si otro elemento recibe el puntero.
      await invitacion(page).getByRole('button', { name: 'Recorrido corto' }).click({ trial: true });
      await invitacion(page).getByRole('button', { name: 'Ahora no' }).click({ trial: true });
      expect(medidas.anuncia).toBe(true);

      // No es modal: un enlace del menú recibe el clic; al irse a otra pantalla la invitación se cierra y no tapa sus acciones.
      await page.locator(`${rol.destino}:visible`).first().click();
      await expect(invitacion(page)).toHaveCount(0);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#contenido-principal')).toBeVisible();
      // El rincón donde estaba la invitación ya pertenece a la otra pantalla: ninguna capa del recorrido lo cubre.
      const tapado = await page.evaluate(() => Boolean(document.elementFromPoint(window.innerWidth - 80, window.innerHeight - 80)?.closest('.rv-tour, .rv-onb-inv')));
      expect(tapado, 'la invitación no debe seguir tapando la otra pantalla').toBe(false);
    } finally {
      await ctx.close();
    }
  });
}
