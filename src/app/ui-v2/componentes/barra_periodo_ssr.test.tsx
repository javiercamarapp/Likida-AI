import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarraPeriodo } from './barra-periodo';
import { hrefConParams, ocultosSin } from './barra-periodo-url';

const PERIODOS = [
  { valor: 'mes', etiqueta: 'Este mes', href: '/x?periodo=mes' },
  { valor: '30d', etiqueta: '30 días', href: '/x?periodo=30d' },
  { valor: 'custom', etiqueta: 'Personalizado', href: '/x?periodo=custom' },
];

describe('hrefConParams / ocultosSin (estado en la URL)', () => {
  it('aplica cambios, quita vacíos y SIEMPRE reinicia la paginación', () => {
    expect(hrefConParams('/x', { periodo: '30d', pagina: '3', moneda: 'USD' }, { periodo: 'mes', moneda: null })).toBe('/x?periodo=mes');
    expect(hrefConParams('/x', {}, {})).toBe('/x');
    expect(hrefConParams('/x', { b: '2', a: '1' })).toBe('/x?a=1&b=2');
    expect(hrefConParams('/x', { pagina: '3' }, {}, ['pagina'])).toBe('/x?pagina=3');
  });
  it('ocultosSin deja fuera lo que el formulario edita y la paginación', () => {
    expect(ocultosSin({ tenant: 't', desde: '2026-01-01', pagina: '2', q: '' }, ['desde'])).toEqual([['tenant', 't']]);
  });
});

describe('BarraPeriodo · render de servidor', () => {
  it('una fila: segmentado de enlaces con la opción vigente marcada, sin JavaScript', () => {
    const h = renderToStaticMarkup(<BarraPeriodo periodo={{ etiqueta: 'Periodo', valor: '30d', opciones: PERIODOS }} />);
    expect(h).toContain('role="group"');
    expect(h).toContain('<nav class="rv-seg rv-bp__seg"');
    expect(h.match(/<a /g)).toHaveLength(3);
    expect(h).toMatch(/<a [^>]*href="\/x\?periodo=30d"[^>]*aria-current="true"|<a [^>]*aria-current="true"[^>]*href="\/x\?periodo=30d"/);
    expect(h.match(/aria-current="true"/g)).toHaveLength(1);
  });
  it('chips: la «x» es un enlace con nombre accesible; el informativo no la lleva', () => {
    const h = renderToStaticMarkup(<BarraPeriodo chips={[{ id: 'r', etiqueta: '1 ago – 20 sep', hrefQuitar: '/x' }, { id: 'm', etiqueta: 'USD' }]} />);
    expect(h).toContain('<ul class="rv-bp__chips"');
    expect(h).toContain('aria-label="Quitar 1 ago – 20 sep"');
    expect(h).not.toContain('Quitar USD');
  });
  it('sin cajón no hay botón «Filtros» (no se inventan filtros); con cajón sí, con el contador', () => {
    expect(renderToStaticMarkup(<BarraPeriodo periodo={{ etiqueta: 'P', valor: 'mes', opciones: PERIODOS }} />)).not.toContain('Filtros');
    const h = renderToStaticMarkup(<BarraPeriodo cajon={{ accion: '/x', limpiarHref: '/x', nActivos: 2 }} accion={<a href="/pub">Última publicación</a>} />);
    expect(h).toContain('aria-haspopup="dialog"');
    expect(h).toMatch(/Filtros<\/span><span class="rv-bp__n"[^>]*>2</);
    expect(h).toContain('rv-bp__accion');
    expect(h).toContain('Última publicación');
  });
  it('el cajón cerrado no pinta el formulario en el servidor (el Drawer se monta al abrir)', () => {
    expect(renderToStaticMarkup(<BarraPeriodo cajon={{ accion: '/x', limpiarHref: '/x', nActivos: 0 }} />)).not.toContain('<form');
  });
});

describe('R8 · el CSS de la barra respeta la escala y los tokens', () => {
  const css = readFileSync(join(__dirname, '..', 'barra-periodo.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('sin tamaños 11.5 / 12.5 / 13.5 / 22 px', () => { expect(css).not.toMatch(/\b(11\.5|12\.5|13\.5|22)px/); });
  it('el activo usa --seg-activo-*, no un azul suelto', () => {
    expect(css).toContain('var(--seg-activo-bg)');
    expect(css).not.toMatch(/#(?:2f6bd8|1f4fb0|e6edfa)/i);
  });
});
