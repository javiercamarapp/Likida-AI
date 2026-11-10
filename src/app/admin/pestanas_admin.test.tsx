import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

let ruta = '/admin/agente-ocr';
vi.mock('next/navigation', () => ({ usePathname: () => ruta }));
const { default: PestanasAdmin } = await import('./pestanas-admin');

describe('PestanasAdmin', () => {
  it('pinta las pestañas del grupo y marca la actual', () => {
    ruta = '/admin/agente-ocr';
    const html = renderToStaticMarkup(<PestanasAdmin />);
    expect(html).toContain('aria-label="Secciones de Agentes"');
    expect(html).toContain('href="/admin/agente-cuadre"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>OCR</);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it('no pinta nada en una página de grupo único o fuera de los grupos', () => {
    ruta = '/admin/soporte';
    expect(renderToStaticMarkup(<PestanasAdmin />)).toBe('');
    ruta = '/admin';
    expect(renderToStaticMarkup(<PestanasAdmin />)).toBe('');
  });
});
