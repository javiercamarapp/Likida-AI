import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AreaMini, BarraApilada, Bullet, DonaMini, Sparkline } from './index';

describe('gráficas básicas', () => {
  it('Sparkline: 72×24 y con <2 puntos válidos no pinta una raya falsa', () => {
    const h = renderToStaticMarkup(<Sparkline valores={[1, 3, 2, 5]} matiz={2} />);
    expect(h).toContain('width="72"');
    expect(h).toContain('height="24"');
    expect(h).toContain('r="2.25"');
    expect(renderToStaticMarkup(<Sparkline valores={[4]} />)).toBe('');
    expect(renderToStaticMarkup(<Sparkline valores={[null, 3, null]} />)).toBe('');
  });
  it('AreaMini: <2 puntos = celda punteada que conserva el alto; con serie trae tabla accesible y «—» para nulos', () => {
    const v = renderToStaticMarkup(<AreaMini valores={[5]} etiqueta="Serie" alto={140} />);
    expect(v).toContain('mc-vacio');
    expect(v).toContain('height="140"');
    const h = renderToStaticMarkup(<AreaMini valores={[1, null, 3]} etiquetas={['a', 'b', 'c']} etiqueta="Cierres" />);
    expect(h).toContain('aria-label="Cierres"');
    expect(h).toContain('<td class="rv-num">—</td>');
  });
  it('AreaMini: un nulo CORTA el relleno y la línea (no se interpola) y marca el hueco punteado', () => {
    const h = renderToStaticMarkup(<AreaMini valores={[2, 4, null, 6, 8]} etiqueta="Con hueco" />);
    expect(h.match(/fill="url\(#/g)).toHaveLength(2); // un relleno por tramo contiguo, no uno que cubra el hueco
    expect(h).toContain('rv-area__hueco');
    expect(h.match(/class="rv-area__linea"/g)).toHaveLength(2); // un trazo por tramo contiguo
    const sin = renderToStaticMarkup(<AreaMini valores={[2, 4, 6]} etiqueta="Sin hueco" />);
    expect(sin).not.toContain('rv-area__hueco');
  });
  it('AreaMini: dos áreas del mismo matiz no repiten el id del degradado', () => {
    const h = renderToStaticMarkup(<><AreaMini valores={[1, 2, 3]} matiz={1} etiqueta="A" /><AreaMini valores={[3, 2, 1]} matiz={1} etiqueta="B" /></>);
    const ids = [...h.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
  it('Sparkline: un nulo corta la línea, no une los puntos vecinos', () => {
    const h = renderToStaticMarkup(<Sparkline valores={[1, 2, null, 5, 6]} />);
    const d = /class="rv-spark__linea" d="([^"]+)"/.exec(h)![1];
    expect(d.match(/M/g)).toHaveLength(2);
  });
  it('DonaMini: nunca más de 5 gajos (agrupa «Otros») y el nulo no suma ni se pinta como 0', () => {
    const gajos = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((e, i) => ({ etiqueta: e, valor: 10 - i }));
    const h = renderToStaticMarkup(<DonaMini gajos={gajos} etiqueta="Rubros" />);
    expect(h.match(/rv-dona__gajo/g)).toHaveLength(5);
    expect(h).toContain('Otros');
    const n = renderToStaticMarkup(<DonaMini gajos={[{ etiqueta: 'x', valor: null }]} etiqueta="Vacía" />);
    expect(n).not.toContain('rv-dona__gajo');
    expect(n).toContain('>—<');
  });
  it('BarraApilada: tramo nulo no se pinta (no es 0) y sale «—» en la leyenda; parcial = trama', () => {
    const h = renderToStaticMarkup(<BarraApilada etiqueta="Estado" tramos={[{ etiqueta: 'A', valor: 8 }, { etiqueta: 'B', valor: null }, { etiqueta: 'C', valor: 2, parcial: true }]} />);
    expect(h.match(/rv-apilada__tramo/g)).toHaveLength(2);
    expect(h).toContain('data-parcial="true"');
    expect(h).toContain('<b>—</b>');
  });
  it('Bullet: meter accesible; sin dato = «—» y pista vacía, nunca relleno 0', () => {
    const h = renderToStaticMarkup(<Bullet etiqueta="A tiempo" valor={91} meta={95} maximo={100} />);
    expect(h).toContain('role="meter"');
    expect(h).toContain('aria-valuenow="91"');
    expect(h).toContain('rv-bullet__meta');
    const n = renderToStaticMarkup(<Bullet etiqueta="A tiempo" valor={null} />);
    expect(n).not.toContain('rv-bullet__relleno');
    expect(n).toContain('Sin dato');
  });
});
