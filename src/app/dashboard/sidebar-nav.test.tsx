// ═══════════════════════════════════════════════════════════════════════════
// H1 (auditoría 24) — EL SIDEBAR NO INVENTA LA FLOTA.
//
// El menú arrastraba `?vista=demo` en CADA link cuando la URL no traía
// parámetros y el rol era superadmin. Ese supuesto («sin sufijo estás en la
// demo») murió el 16-ago-2026 con /admin/elegir-flota: quien elige Innovativos
// y aterriza en `/dashboard` ve SU panel, y el primer clic del menú lo mandaba
// a la demo con un parámetro que nadie escribió y sin cinta que lo dijera.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

let query = '';
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(query),
}));

const { default: SidebarNav } = await import('./sidebar-nav');

function pintar(rol: string, qs: string): string {
  query = qs;
  return renderToStaticMarkup(<SidebarNav rol={rol} />);
}

describe('el sufijo que arrastra el menú', () => {
  it('superadmin SIN parámetros: los links van pelones — la cookie firmada decide, como en el servidor', () => {
    const html = pintar('superadmin', '');
    expect(html).not.toContain('vista=demo');
    expect(html).toContain('href="/dashboard/viajes"');
  });

  it('superadmin CON `?tenant=`: el parámetro viaja en cada link (perderlo te saca de la flota que ves)', () => {
    const html = pintar('superadmin', 'tenant=t-innovativos');
    expect(html).toContain('href="/dashboard/viajes?tenant=t-innovativos"');
  });

  it('`?vista=demo` explícito SÍ se conserva: previsualizar la demo sigue siendo una intención escrita', () => {
    const html = pintar('superadmin', 'vista=demo&rol=contador');
    expect(html).toContain('vista=demo&amp;rol=contador');
  });

  it('un rol real nunca lleva sufijo', () => {
    const html = pintar('flota_admin', '');
    expect(html).not.toContain('?vista=');
    expect(html).not.toContain('?tenant=');
  });
});
