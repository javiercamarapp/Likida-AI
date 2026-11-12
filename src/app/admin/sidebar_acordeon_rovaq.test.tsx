import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/costos-facturacion', useSearchParams: () => new URLSearchParams() }));
const { default: SidebarNav } = await import('./sidebar-nav');

// Sidebar idéntico al de Rovaq (11-nov): grupos en acordeón con UN solo grupo abierto, el del ítem activo; chevron › cerrado, ⌄ abierto.
describe('acordeón del sidebar de /admin (como Rovaq)', () => {
  const html = renderToStaticMarkup(<SidebarNav />);
  const toggles = [...html.matchAll(/<button[^>]*rv-grupo__tog[^>]*>/g)].map((m) => m[0]);
  it('cada grupo es un botón con aria-expanded y aria-controls', () => {
    expect(toggles.length).toBeGreaterThanOrEqual(3);
    for (const t of toggles) { expect(t).toMatch(/aria-expanded="(true|false)"/); expect(t).toContain('aria-controls='); }
  });
  it('exactamente UN grupo abierto al cargar', () => {
    expect(toggles.filter((t) => t.includes('aria-expanded="true"'))).toHaveLength(1);
  });
  it('el chevron del grupo gira 90° al abrir (› cerrado, ⌄ abierto)', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/ui-v2/shell.css'), 'utf8');
    expect(css).toMatch(/\.rv-grupo\[data-abierto\] \.rv-grupo__chev \{ transform: rotate\(90deg\)/);
  });
});
