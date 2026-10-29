import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(), usePathname: () => '/dashboard/agentes/peajes',
}));
const { default: DashboardChromeV2 } = await import('./chrome-v2');

const pintar = (rol: string, perfil: 'cinco_agentes' | null = 'cinco_agentes') =>
  renderToStaticMarkup(
    <DashboardChromeV2 nombre="Ana Pérez" rol={rol} perfil={perfil} cerrarSesion={async () => {}}>
      <p>contenido</p>
    </DashboardChromeV2>,
  );

describe('DashboardChromeV2: el contrato que no se rompe', () => {
  const html = pintar('flota_admin');

  it('el div raíz lleva data-ui="v2" junto a tema-neutro (renderizado en servidor)', () => {
    expect(html).toMatch(/<div class="[^"]*tema-neutro[^"]*" data-ui="v2"/);
  });

  it('<aside> con <nav> y enlaces reales, #contenido-principal y «Saltar al contenido»', () => {
    expect(html).toContain('<aside');
    expect(html).toContain('aria-label="Navegación principal"');
    expect(html).toContain('href="#contenido-principal"');
    expect(html).toContain('Saltar al contenido');
    expect(html).toContain('id="contenido-principal"');
    expect(html).toContain('<p>contenido</p>');
  });

  it('el ítem activo lleva aria-current="page" y es uno solo', () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>(?:(?!<\/a>).)*Conciliación de peajes/);
  });

  it('A4/A5 están en el menú con su enlace real (hoy el perfil los tiene encendidos)', () => {
    expect(html).toContain('href="/dashboard/agentes/vigia"');
    expect(html).toContain('href="/dashboard/agentes/conductores"');
  });

  it('"Cerrar sesión" existe en la tarjeta de cuenta y en la hoja móvil, y la etiqueta del rol viene del servidor', () => {
    expect(html.match(/aria-label="Cerrar sesión"/g)?.length).toBe(1);
    expect(html).toContain('ADMIN FLOTA');
  });

  it('hay cabecera móvil con el botón «Más» y la hoja existe (cerrada = sin open)', () => {
    expect(html).toContain('aria-label="Más: abrir el menú completo"');
    expect(html).toMatch(/<dialog[^>]*class="rv-hoja"/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  });

  it('cada ítem del menú lleva su ancla data-tour estable (para el recorrido guiado) y el botón Más también', () => {
    expect(html).toContain('data-tour="nav-agentes-peajes"');
    expect(html).toContain('data-tour="nav-conexiones"');
    expect(html).toContain('data-tour="nav-puesta-en-marcha"');
    expect(html).toContain('data-tour="nav-mas"');
  });

  it('no pinta el shader de fondo de v1', () => {
    expect(html).not.toContain('sb-aside');
  });

  it('el contador no ve el Resumen del dueño; entra por Liquidación', () => {
    const c = pintar('contador');
    expect(c).not.toMatch(/href="\/dashboard"/);
    expect(c).toContain('href="/dashboard/agentes/liquidacion"');
  });

  it('sin perfil usa el menú genérico (Dinero y fiscal)', () => {
    expect(pintar('flota_admin', null)).toContain('Dinero y fiscal');
  });
});
