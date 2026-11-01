import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TabsLinea } from './index';

describe('TabsLinea', () => {
  const h = renderToStaticMarkup(<TabsLinea etiqueta="Secciones de Datos" actual="fuentes" pestanas={[
    { clave: 'resumen', etiqueta: 'Resumen', href: '/a' }, { clave: 'fuentes', etiqueta: 'Fuentes', href: '/b', conteo: 0 },
  ]} />);
  it('es una nav con nombre y enlaces reales; solo la actual lleva aria-current="page"', () => {
    expect(h).toContain('<nav aria-label="Secciones de Datos"');
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toMatch(/<a [^>]*href="\/b"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*href="\/b"/);
    expect(h).toContain('data-cero="true"');
    expect(h).not.toContain('style=');
  });
});
