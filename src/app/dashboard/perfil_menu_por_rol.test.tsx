import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// RED DE SEGURIDAD DEL MENÚ POR ROL BAJO `cinco_agentes` (Fase 0.5 del rediseño).
//
// Hoy NINGUNA prueba recorre el menú de `cinco_agentes` por rol (0 cobertura en
// los e2e): el shell v2 (Fase 1) sustituye al sidebar, así que antes de tocarlo
// se fija QUÉ ve cada rol y que NINGÚN enlace del menú rebote. Es el calco
// estático de `pruebas-navegador/perfil-menu.nav.ts` (el recorrido de clics real,
// que corre en CI con la pila local). Un enlace del menú que `puedeVerRuta` niega
// es un enlace que, al clic, devuelve al usuario a /dashboard sin explicación.
//
// Datos: ningún nombre ni cifra real; solo roles y rutas del producto.
// ═══════════════════════════════════════════════════════════════════════════

const ruta = { actual: '/dashboard' };
vi.mock('next/navigation', () => ({
  usePathname: () => ruta.actual,
  useSearchParams: () => new URLSearchParams(''),
  redirect: (d: string) => { throw new Error(`REDIRECT:${d}`); },
}));

const { default: SidebarNav, SidebarAbajo } = await import('./sidebar-nav');
const { puedeVerRuta, RUTAS_PERFIL_CINCO_AGENTES, rutaProximamente } = await import('@/lib/auth/visibilidad');

const hrefsDe = (html: string) => [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];

/** El menú tal como lo pinta el chrome: la nav (con la sección de la ruta actual abierta) + el bloque inferior. */
function menu(rol: string, abrir: string): string[] {
  ruta.actual = abrir;
  const html = renderToStaticMarkup(<SidebarNav rol={rol} perfil="cinco_agentes" />)
    + renderToStaticMarkup(<SidebarAbajo rol={rol} perfil="cinco_agentes" />);
  ruta.actual = '/dashboard';
  return hrefsDe(html);
}

// El acordeón solo pinta la sección abierta: se abre cada una para ver TODO el menú del rol.
const SECCIONES = ['/dashboard', '/dashboard/agentes/liquidacion', '/dashboard/mi-perfil', '/dashboard/conexiones'];
const menuCompleto = (rol: string) => [...new Set(SECCIONES.flatMap((s) => menu(rol, s)))];

const ROLES = ['flota_admin', 'encargado', 'contador'] as const;
const destinoPermitido = (h: string) =>
  Object.keys(RUTAS_PERFIL_CINCO_AGENTES).includes(h) || ['vigia', 'conductor'].some((m) => h === rutaProximamente(m as 'vigia'));

describe.each(ROLES)('menú de %s bajo cinco_agentes', (rol) => {
  const hrefs = menuCompleto(rol).filter((h) => h.startsWith('/dashboard'));

  it('trae enlaces reales del panel', () => {
    expect(hrefs.length).toBeGreaterThan(3);
  });

  it('todo enlace cae en la lista cerrada del perfil', () => {
    for (const h of hrefs) expect(destinoPermitido(h), `${rol} → ${h}`).toBe(true);
  });

  it('ningún enlace rebota: el rol puede ver cada destino (o es un anuncio «próximamente»)', () => {
    for (const h of hrefs) {
      const esAnuncio = ['vigia', 'conductor'].some((m) => h === rutaProximamente(m as 'vigia'));
      if (!esAnuncio) expect(puedeVerRuta(rol, h, 'cinco_agentes'), `${rol} → ${h}`).toBe(true);
    }
  });

  it('nunca enseña la consola interna', () => {
    expect(menuCompleto(rol).some((h) => h.startsWith('/admin') || h.startsWith('/vendedor'))).toBe(false);
  });
});

describe('diferencias entre roles (fotografía del 28-oct-2026; si cambia a propósito, se actualiza aquí)', () => {
  it('el contador ve solo sus cinco enlaces: soporte, notificaciones, perfil, liquidación y peajes', () => {
    expect(menuCompleto('contador').filter((h) => h.startsWith('/dashboard')).sort()).toEqual([
      '/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/mi-perfil', '/dashboard/notificaciones', '/dashboard/soporte',
    ]);
  });

  it('el encargado no ve dinero ni administración', () => {
    const e = menuCompleto('encargado');
    for (const h of ['/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/conexiones', '/dashboard/usuarios', '/dashboard/llaves-api', '/dashboard/contador'])
      expect(e, h).not.toContain(h);
  });

  it('solo el dueño administra: conexiones, usuarios y llaves', () => {
    const d = menuCompleto('flota_admin');
    for (const h of ['/dashboard/conexiones', '/dashboard/usuarios', '/dashboard/llaves-api']) expect(d, h).toContain(h);
  });

  it('el contador no ve despacho', () => {
    expect(menuCompleto('contador')).not.toContain('/dashboard/despacho');
  });
});
