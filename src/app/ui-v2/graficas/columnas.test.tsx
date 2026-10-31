import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Columnas } from './columnas';
import { TiraKpi } from './tira-kpi';

const datos = [{ etiqueta: '7 sep', valor: 4 }, { etiqueta: '14 sep', valor: 0 }, { etiqueta: '21 sep', valor: 8, parcial: true }];

describe('Columnas', () => {
  it('es un SVG con una columna por dato (cero incluido, mín. 2 px) y la parcial marcada', () => {
    const h = renderToStaticMarkup(<Columnas datos={datos} etiqueta="Cierres" />);
    expect(h).toContain('<svg');
    expect((h.match(/rv-colum__barra/g) ?? []).length).toBe(3);
    expect(h).toContain('data-parcial="true"');
    expect(h).toContain('data-cero-fuente');
  });
  it('trae eje de 3 marcas, leyenda de parcial y «Ver como tabla» con los mismos valores', () => {
    const h = renderToStaticMarkup(<Columnas datos={datos} etiqueta="Cierres" formato={(v) => `${v} cierres`} />);
    expect((h.match(/class="rv-gr__marca"/g) ?? []).length).toBe(3);
    expect(h).toContain('trama = parcial');
    expect(h).toContain('Ver como tabla');
    expect(h).toContain('<td class="rv-num">8 cierres</td>');
    expect(h).toContain('role="img"');
  });
  it('un valor null no se dibuja ni se vuelve cero: sale «s/d» y la leyenda lo explica', () => {
    const h = renderToStaticMarkup(<Columnas datos={[{ etiqueta: 'a', valor: 3 }, { etiqueta: 'b', valor: null }]} etiqueta="x" />);
    expect((h.match(/rv-colum__barra/g) ?? []).length).toBe(1);
    expect(h).toContain('>s/d<');
    expect(h).toContain('s/d = sin datos');
    expect(h).toContain('<td class="rv-num">—</td>');
  });
  it('todo en cero: plano sin columnas y UNA línea que dice qué falta', () => {
    const h = renderToStaticMarkup(<Columnas datos={datos.map((d) => ({ ...d, valor: 0 }))} etiqueta="x" vacio="Sin cierres" />);
    expect(h).toContain('Sin cierres');
    expect(h).not.toContain('rv-colum__barra');
    expect(h).toContain('<svg');
  });
  it('no usa style= (CSP con nonce): el retardo escalonado sale de data-r y del CSS', () => {
    const h = renderToStaticMarkup(<Columnas datos={datos} etiqueta="x" />);
    expect(h).not.toContain('style=');
    expect(h).toContain('data-r="2"');
  });
  it('trae la animación solo bajo no-preference (CSS)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${__dirname}/../graficas.css`, 'utf8');
    const i = css.indexOf('rv-crece-y');
    expect(i).toBeGreaterThan(0);
    expect(css.lastIndexOf('prefers-reduced-motion: no-preference', i)).toBeGreaterThan(css.lastIndexOf('}\n', i - 200));
  });
});

describe('TiraKpi · cero con fuente', () => {
  it('un 0 con sello (fuente y periodo) lo declara; un 0 sin sello no', () => {
    const con = renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'A', valor: '$0.00', sello: 'Liquidaciones · 30 días' }]} />);
    const sin = renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'A', valor: 0 }]} />);
    expect(con).toContain('data-cero-fuente');
    expect(sin).not.toContain('data-cero-fuente');
  });
});
