/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALIDAD VISUAL VERIFICABLE (F22). Sin red ni producción: corre contra el mismo `next start` + Supabase local que el resto de
 * la suite. Convierte en pruebas los defectos que las rondas de revisión visual encontraron a ojo:
 *   · scroll horizontal de página a 412 px (Techo de IA, ronda 1),
 *   · más de un <h1> (doble h1 de las pantallas con cabecera propia),
 *   · títulos encimados o de una palabra por línea (Dev a 412 px, Unidades).
 * Las reglas de decisión viven en scripts/ci/calidad-visual.mjs (puras) y se prueban con casos sintéticos MALOS en
 * scripts/ci/calidad_visual.test.ts: si el evaluador dejara de detectar, esa prueba lo dice sin necesitar navegador.
 * Presupuesto de hallazgos: vacío. Una ruta con hallazgo se arregla; no se agrega a una lista de excepciones.
 * NO CORRIDO EN LOCAL al escribirse (exige la pila de Supabase + build): su primera corrida real es la de CI.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, type Page } from './apoyo/fixture';
import { ESTADOS } from './apoyo/sesion';
import { evaluarDesborde, evaluarH1, evaluarTitulosEncimados } from '../scripts/ci/calidad-visual.mjs';

const ANCHO_MOVIL = 412;

interface Cajas { texto: string; x: number; y: number; w: number; h: number }

async function medir(page: Page) {
  return page.evaluate(() => {
    const raiz = document.scrollingElement ?? document.documentElement;
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const e = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && e.visibility !== 'hidden' && e.display !== 'none' && !el.closest('[hidden]')
        // El cuerpo de un <details> cerrado no se ve, aunque Chromium le calcule caja (content-visibility): no cuenta para encimados.
        && !(el.closest('details:not([open])') && !el.closest('summary'));
    };
    const h1 = [...document.querySelectorAll('h1')].filter(visible).map((el) => (el.textContent ?? '').trim());
    const cajas = [...document.querySelectorAll('h1, h2, h3')].filter(visible).map((el) => {
      const r = el.getBoundingClientRect();
      return { texto: (el.textContent ?? '').trim().slice(0, 80), x: r.x, y: r.y, w: r.width, h: r.height };
    });
    return { scrollWidth: raiz.scrollWidth, innerWidth: window.innerWidth, h1, cajas };
  });
}

async function revisar(page: Page, ruta: string): Promise<string[]> {
  const respuesta = await page.goto(ruta);
  expect(respuesta?.status(), `${ruta} no respondió 2xx`).toBeLessThan(400);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const m = await medir(page);
  const cajas: Cajas[] = m.cajas;
  return [
    ...evaluarDesborde(m),
    ...evaluarH1(m.h1),
    ...evaluarTitulosEncimados(cajas),
  ].map((f: string) => `${ruta}: ${f}`);
}

const RUTAS_ADMIN = ['/admin', '/admin/consumo', '/admin/techo-ia', '/admin/dev', '/admin/flotas', '/admin/equipo', '/admin/agentes'];
const RUTAS_DASHBOARD = ['/dashboard', '/dashboard/viajes', '/dashboard/despacho', '/dashboard/unidades', '/dashboard/operadores', '/dashboard/facturacion', '/dashboard/agentes'];

test.describe(`a ${ANCHO_MOVIL} px: sin scroll horizontal, un solo h1 y títulos sin encimar`, () => {
  test.use({ viewport: { width: ANCHO_MOVIL, height: 900 } });

  test.describe('admin', () => {
    test.use({ storageState: ESTADOS.superadmin });
    test('rutas principales de /admin', async ({ page }) => {
      const hallazgos: string[] = [];
      for (const ruta of RUTAS_ADMIN) hallazgos.push(...(await revisar(page, ruta)));
      expect(hallazgos, hallazgos.join('\n')).toEqual([]);
    });
  });

  test.describe('dashboard', () => {
    test.use({ storageState: ESTADOS.duena });
    test('rutas principales de /dashboard', async ({ page }) => {
      const hallazgos: string[] = [];
      for (const ruta of RUTAS_DASHBOARD) hallazgos.push(...(await revisar(page, ruta)));
      expect(hallazgos, hallazgos.join('\n')).toEqual([]);
    });
  });
});

test.describe('a 1440 px: un solo h1 y sin scroll horizontal', () => {
  test.use({ viewport: { width: 1440, height: 900 }, storageState: ESTADOS.duena });
  test('rutas principales de /dashboard', async ({ page }) => {
    const hallazgos: string[] = [];
    for (const ruta of RUTAS_DASHBOARD) hallazgos.push(...(await revisar(page, ruta)));
    expect(hallazgos, hallazgos.join('\n')).toEqual([]);
  });
});
