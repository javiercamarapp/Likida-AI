import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/copiloto', useSearchParams: () => new URLSearchParams() }));
const { default: SidebarNav } = await import('./sidebar-nav');

// Decisión del dueño (11-nov-2026): en el sidebar del superadmin «Copiloto» va justo DEBAJO de «Resumen», como entrada de primer nivel.
describe('SidebarNav de /admin: Copiloto bajo Resumen', () => {
  const html = renderToStaticMarkup(<SidebarNav />);
  it('el orden es Resumen, Copiloto y solo después la primera sección (Agentes)', () => {
    const resumen = html.indexOf('href="/admin"');
    const copiloto = html.indexOf('href="/admin/copiloto"');
    const seccion = html.indexOf('rv-grupo__tog');
    expect(resumen).toBeGreaterThanOrEqual(0);
    expect(copiloto).toBeGreaterThan(resumen);
    expect(copiloto).toBeLessThan(seccion);
  });
  it('queda en la misma lista que Resumen (primer nivel) y marcado como página actual en su ruta', () => {
    const lista = html.slice(0, html.indexOf('</ul>'));
    expect(lista).toContain('href="/admin/copiloto"');
    expect(lista).toMatch(/aria-current="page"[^>]*href="\/admin\/copiloto"/);
  });
  it('no vuelve a aparecer dentro del grupo Agentes', () => {
    expect(html.match(/href="\/admin\/copiloto"/g)).toHaveLength(1);
  });
});
