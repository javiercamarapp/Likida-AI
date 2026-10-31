/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECORRIDO DEL MENÚ POR ROL BAJO `cinco_agentes` (Fase 0.5 del rediseño, v1).
 *
 * Hasta hoy los 26 e2e corren sobre flotas SIN perfil: el menú recortado que ve
 * un cliente de cinco agentes no lo recorría nadie. Esta prueba entra como los
 * tres roles de «Flota E2E Perfil» (sembrada por sembrar-e2e.mjs con
 * `tenant_perfil = cinco_agentes`) y, para cada enlace que el menú de ese rol
 * debe tener, hace clic y exige: la página carga (sin «No se pudo cargar el
 * panel.»), la URL NO rebota a otro sitio, y el enlace estaba de verdad en el
 * menú. Y la inversa: lo que el perfil o el rol niegan rebota a /dashboard.
 *
 * El calco sin navegador (qué enlaces trae cada rol) vive en
 * src/app/dashboard/perfil_menu_por_rol.test.tsx; las listas de aquí y de allá
 * se mantienen a la par a propósito.
 *
 * PRESUPUESTO DE CORREOS (ver apoyo/sesion.ts): el login admite 10 envíos / 5 min
 * por IP y la suite ya gasta 10. Estos 3 logins van con su PROPIA IP de origen
 * (`x-forwarded-for`, que `login/page.tsx` usa de llave) para no consumir ese
 * techo ni ser rechazados por él.
 *
 * NO CORRIDO EN LOCAL al escribirse (exige Docker con la pila de Supabase de
 * Likida + build de producción); su primera corrida real es la de CI.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { CORREOS, entrar } from './apoyo/sesion';

/** Escapa TODO metacaracter de regex (incluida la barra invertida) para armar un RegExp desde una ruta. */
const escaparRegex = (t: string) => t.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

const ROLES = [
  {
    nombre: 'dueño', correo: CORREOS.perfilDueno, ip: '10.77.0.1',
    menu: ['/dashboard/despacho', '/dashboard/viajes', '/dashboard/operadores', '/dashboard/unidades', '/dashboard/mapa', '/dashboard/carta-porte',
      '/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/agentes/carta-porte', '/dashboard/conexiones', '/dashboard/usuarios', '/dashboard/mi-perfil'],
    negadas: ['/dashboard/chat', '/dashboard/facturacion', '/dashboard/rentabilidad', '/dashboard/suscripcion'],
  },
  {
    nombre: 'encargado', correo: CORREOS.perfilEncargado, ip: '10.77.0.2',
    menu: ['/dashboard/despacho', '/dashboard/viajes', '/dashboard/operadores', '/dashboard/unidades', '/dashboard/mapa', '/dashboard/carta-porte', '/dashboard/agentes/carta-porte', '/dashboard/mi-perfil'],
    negadas: ['/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/conexiones', '/dashboard/usuarios', '/dashboard/chat'],
  },
  {
    nombre: 'contador', correo: CORREOS.perfilContador, ip: '10.77.0.3',
    menu: ['/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/notificaciones', '/dashboard/mi-perfil'],
    negadas: ['/dashboard/despacho', '/dashboard/viajes', '/dashboard/conexiones', '/dashboard/usuarios', '/dashboard/chat'],
  },
] as const;

async function sana(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'No se pudo cargar el panel.' })).toHaveCount(0);
  await expect(page.locator('[data-nextjs-dialog], .next-error-h1')).toHaveCount(0);
}

for (const rol of ROLES) {
  test(`${rol.nombre} (cinco_agentes): cada enlace de su menú abre y ninguno rebota`, async ({ browser }) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': rol.ip } });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    try {
      await entrar(page, rol.correo);
      await expect(page).toHaveURL(/\/dashboard/);
      await sana(page);
      // El menú existe, es el del rol y no trae nada de la consola interna.
      await expect(page.locator('aside')).toHaveCount(1);
      expect(await page.locator('aside a[href^="/admin"], aside a[href^="/vendedor"]').count()).toBe(0);

      for (const href of rol.menu) {
        // Por clic cuando el enlace ya está a la vista (secciones abiertas del acordeón); si su sección
        // está plegada, por navegación directa: lo que se prueba es que el destino abre y no rebota.
        const enlace = page.locator(`aside a[href="${href}"]`).first();
        if (await enlace.isVisible().catch(() => false)) await enlace.click();
        else await page.goto(href);
        await expect(page, `${rol.nombre}: ${href} rebotó`).toHaveURL(new RegExp(`${escaparRegex(href)}(\\?.*)?$`));
        await sana(page);
      }
      for (const href of rol.negadas) {
        await page.goto(href);
        await expect(page, `${rol.nombre}: ${href} debía negarse`).toHaveURL(/\/dashboard(\?.*)?$|\/dashboard\/agentes\/[a-z-]+(\?.*)?$|\/dashboard\/contador(\?.*)?$/);
        await expect(page).not.toHaveURL(new RegExp(`${escaparRegex(href)}$`));
      }
      expect(errores).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
