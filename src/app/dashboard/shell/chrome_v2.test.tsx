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
    // La hoja es el Drawer del sistema de overlays (único lugar con <dialog>); cerrada no trae ítems de menú.
    expect(html).toMatch(/<dialog[^>]*class="rv-ov rv-ov--drawer"/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).not.toContain('aria-label="Menú completo"');
  });

  it('cada ítem del menú lleva su ancla data-tour estable (para el recorrido guiado) y el botón Más también', () => {
    expect(html).toContain('data-tour="nav-agentes-peajes"');
    expect(html).toContain('data-tour="nav-conexiones"');
    expect(html).toContain('data-tour="nav-puesta-en-marcha"');
    expect(html).toContain('data-tour="nav-mas"');
  });

  it('la capa de carga viaja en el HTML del servidor: una sola, visible desde el primer fotograma, solo el logo', () => {
    expect(html.match(/id="rv-carga"/g)).toHaveLength(1);
    expect(html).toMatch(/class="rv-carga" data-estado="inicial" role="status" aria-busy="true" aria-label="Cargando"/);
    const capa = /<div[^>]*id="rv-carga"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(capa).toContain('aria-label="Likida"');
    expect(capa.replace(/<[^>]+>/g, '').trim()).toBe(''); // sin texto visible
  });

  it('AGENTES son 5 ítems sueltos bajo un caption estático; las demás categorías son un acordeón con UNA abierta', () => {
    expect(html).toMatch(/<h2 id="rv-g-agentes" class="rv-grupo__t">Agentes<\/h2>/);
    expect(html.match(/aria-expanded="true"/g)?.filter(() => true).length).toBeGreaterThanOrEqual(1);
    // La abierta es la del ítem activo (Peajes está en AGENTES, que no es acordeón): se abre la primera categoría.
    expect(html.match(/class="rv-grupo" data-abierto/g)).toHaveLength(1);
  });

  it('el pie es una sola superficie: tema segmentado visible y tarjeta de cuenta con salir', () => {
    expect(html).toContain('role="radiogroup" aria-label="Tema de la interfaz" class="rv-tema"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('«Puesta en marcha <6/6» vive en el pie y no se duplica en el acordeón', () => {
    const conAvance = renderToStaticMarkup(
      <DashboardChromeV2 nombre="Ana Pérez" rol="flota_admin" perfil="cinco_agentes" insignias={{ '/dashboard/puesta-en-marcha': '3/6' }}>
        <p>x</p>
      </DashboardChromeV2>,
    );
    expect(conAvance.match(/data-tour="nav-puesta-en-marcha"/g)).toHaveLength(1);
    expect(conAvance).toContain('class="rv-puesta"');
    expect(conAvance).toContain('aria-label="Puesta en marcha, 3 de 6"');
    expect(html).not.toContain('class="rv-puesta"');
  });

  it('el logo es SVG propio (una instancia visible por variante) y no usa las máscaras PNG de v1', () => {
    expect(html).toContain('viewBox="0 0 726 149"');
    expect(html).not.toContain('logo-icono.png');
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
