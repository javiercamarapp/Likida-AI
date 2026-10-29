import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayoutGrid } from 'lucide-react';
import { gruposAbiertosPorOmision, ArbolMenu } from './navegacion-v2';
import type { MenuV2 } from './menu-por-perfil';

const item = (href: string, nombre: string) => ({ href, nombre, Icono: LayoutGrid });
const MENU: MenuV2 = {
  resumen: [item('/dashboard', 'Resumen')],
  grupos: [
    { id: 'a', titulo: 'Agentes', items: [item('/dashboard/a1', 'A1'), item('/dashboard/a2', 'A2')] },
    { id: 'b', titulo: 'Operación', items: [item('/dashboard/b1', 'B1'), item('/dashboard/b2', 'B2')] },
    { id: 'c', titulo: 'Marcha', items: [item('/dashboard/c1', 'C1')] },
  ],
  pie: [],
};

describe('grupos colapsables del sidebar v2', () => {
  it('arrancan abiertos: el primero, los de un solo ítem y el de la página activa', () => {
    expect(gruposAbiertosPorOmision(MENU, null)).toEqual({ a: true, b: false, c: true });
    expect(gruposAbiertosPorOmision(MENU, '/dashboard/b2')).toEqual({ a: true, b: true, c: true });
  });
  it('colapsable: el título es un botón con aria-expanded; sin colapsable el marcado es el de siempre', () => {
    const con = renderToStaticMarkup(<ArbolMenu menu={MENU} sufijo="" pathname="/dashboard" colapsable />);
    expect(con).toContain('aria-expanded="false"'); // Operación plegada
    expect(con).toContain('aria-expanded="true"');
    expect(con).toContain('href="/dashboard/b1"'); // el enlace sigue en el HTML (visibility oculta, no removido)
    const sin = renderToStaticMarkup(<ArbolMenu menu={MENU} sufijo="" pathname="/dashboard" />);
    expect(sin).not.toContain('aria-expanded');
  });
  it('la página activa mantiene su grupo abierto aunque esté plegado por omisión', () => {
    const html = renderToStaticMarkup(<ArbolMenu menu={MENU} sufijo="" pathname="/dashboard/b1" colapsable />);
    expect(html).not.toContain('aria-expanded="false"');
  });
});
