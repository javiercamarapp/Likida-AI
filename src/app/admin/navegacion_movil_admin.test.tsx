import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/consumo', useSearchParams: () => new URLSearchParams() }));

import NavegacionMovilAdmin, { CabeceraMovilAdmin, MENU_ADMIN, destinosBarraAdmin } from './navegacion-movil-admin';
import { ProveedorRequiereAccion } from './cabecera-admin';
import { SECCIONES } from './rutas';
import { readFileSync } from 'node:fs';

// El admin bajo 768 px era un riel de 56 px con 25 iconos SIN etiqueta (revisión visual 10-nov). Ahora usa las piezas del dashboard.
describe('Navegación móvil de /admin: cabecera, barra inferior y hoja «Más» del dashboard con destinos del admin', () => {
  it('la cabecera trae logo, fecha y la campana de Notificaciones con el conteo real (lectura caída = sin dato, sin punto)', () => {
    const con = renderToStaticMarkup(<ProveedorRequiereAccion valor={{ pendientes: 3, hayUrgente: false }}><CabeceraMovilAdmin /></ProveedorRequiereAccion>);
    expect(con).toContain('class="rv-cab-movil"');
    expect(con).toContain('href="/admin/notificaciones"');
    expect(con).toContain('Notificaciones: 3 pendientes');
    expect(con).toContain('rv-campana__punto');
    const sin = renderToStaticMarkup(<ProveedorRequiereAccion valor={{ pendientes: null, hayUrgente: false }}><CabeceraMovilAdmin /></ProveedorRequiereAccion>);
    expect(sin).toContain('Notificaciones: sin dato');
    expect(sin).not.toContain('rv-campana__punto');
  });

  it('la barra inferior lleva 4 destinos CON etiqueta y «Más»; el activo se marca por la entrada de la ruta', () => {
    const html = renderToStaticMarkup(<NavegacionMovilAdmin nombre="Ana" avatarUrl={null} flotas={[]} />);
    expect(html).toContain('class="rv-nav-inf"');
    for (const e of ['Resumen', 'Bandeja', 'Agentes', 'Clientes', 'Más']) expect(html).toContain(`<span class="rv-nav-inf__txt">${e}</span>`);
    // /admin/consumo no es destino de la barra: el activo es «Más».
    expect(html).toMatch(/aria-haspopup="dialog"[^>]*data-activo/);
    expect(destinosBarraAdmin()).toHaveLength(4);
  });

  it('todos los destinos existen en el mapa de rutas y la hoja cubre las cuatro secciones completas', () => {
    const hrefs = new Set([...SECCIONES.flatMap((s) => s.items.map((i) => i.href)), '/admin']);
    for (const d of destinosBarraAdmin()) expect(hrefs.has(d.href)).toBe(true);
    expect(MENU_ADMIN.grupos.map((g) => g.titulo)).toEqual(SECCIONES.map((s) => s.titulo));
    expect(MENU_ADMIN.grupos.flatMap((g) => g.items).length).toBe(SECCIONES.flatMap((s) => s.items).length);
  });

  it('el CSS ya no deja el riel de 56 px bajo 768 px y deja aire inferior para la barra flotante', () => {
    const css = readFileSync(new URL('./admin-shell.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/width:\s*56px/);
    expect(css).toMatch(/max-width:\s*767\.98px\)\s*\{[^}]*\}[\s\S]*padding-bottom:\s*calc\(64px/);
  });
});
