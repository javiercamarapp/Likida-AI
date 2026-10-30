import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { indiceDeMenu } from './nav-utiles';
import { LayoutGrid } from 'lucide-react';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/dashboard' }));
const { default: MenuCuenta } = await import('./menu-cuenta');

const pintarAbierto = () => renderToStaticMarkup(
  <MenuCuenta nombre="Ana Pérez" rol="flota_admin" rolEtiqueta="ADMIN FLOTA" sufijo="" iniciales="AP" abiertoInicial
    filas={[{ href: '/dashboard/mi-perfil', nombre: 'Mi perfil', Icono: LayoutGrid }]} />,
);

describe('indiceDeMenu (flechas, Home, End)', () => {
  it('recorre con vuelta y salta a los extremos', () => {
    expect(indiceDeMenu('ArrowDown', -1, 4)).toBe(0);
    expect(indiceDeMenu('ArrowDown', 3, 4)).toBe(0);
    expect(indiceDeMenu('ArrowUp', 0, 4)).toBe(3);
    expect(indiceDeMenu('ArrowUp', -1, 4)).toBe(3);
    expect(indiceDeMenu('Home', 2, 4)).toBe(0);
    expect(indiceDeMenu('End', 0, 4)).toBe(3);
    expect(indiceDeMenu('a', 0, 4)).toBeNull();
    expect(indiceDeMenu('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('menú de la tarjeta de cuenta abierto', () => {
  const html = pintarAbierto();
  it('es un role=menu cuyos hijos son todos ítems de menú válidos (incluida «Mi cuenta»)', () => {
    expect(html).toContain('role="menu"');
    expect(html).toMatch(/<a[^>]*role="menuitem"[^>]*href="\/cuenta/);
    expect(html).not.toMatch(/<a(?![^>]*role=)[^>]*href=/); // ningún enlace sin role dentro del menú
  });
  it('ofrece el tema (claro / sistema / oscuro) dentro del menú: alcanzable también en riel y tablet', () => {
    expect(html.match(/data-tema="(claro|sistema|oscuro)"/g)).toHaveLength(3);
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(3);
    expect(html).toMatch(/role="menuitemradio" aria-checked="true"[^>]*data-tema="claro"/);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(2);
  });
  it('usa el Popover y el MenuList del sistema de overlays, no un menú propio; ninguna clase propia choca con .rv-menu', () => {
    expect(html).toContain('class="rv-pop"');
    expect(html).toContain('class="rv-menu" role="menu"');
    expect(html).not.toContain('rv-menu__fila');
  });
  it('los ítems no son tabulables (foco programático con flechas)', () => {
    expect(html.match(/tabindex="-1"/g)!.length).toBeGreaterThanOrEqual(5);
  });
});
