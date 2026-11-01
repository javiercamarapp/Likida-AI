import { describe, expect, it } from 'vitest';
import { cadaCuantas, colocarLado, compactEs, esConteoPequeno, geometriaColumnas, indicesEtiquetados, niceScale, ranuraEn, variacionVsAnterior } from './escala';

describe('compactEs', () => {
  it('compacta con es-MX y conserva el signo', () => {
    expect(compactEs(842)).toBe('842');
    expect(compactEs(337_900)).toBe('337.9 mil');
    expect(compactEs(2_100_000)).toBe('2.1 M');
    expect(compactEs(-1500)).toBe('−1.5 mil');
    expect(compactEs(1000)).toBe('1 mil');
  });
  it('no finitos y nulos son «—», nunca 0', () => {
    expect(compactEs(null)).toBe('—');
    expect(compactEs(Number.NaN)).toBe('—');
    expect(compactEs(undefined)).toBe('—');
  });
});

describe('niceScale', () => {
  it('el tope es un paso redondo ≥ max y la mitad también es redonda', () => {
    for (const [max, top] of [[7, 8], [8, 8], [9, 10], [130, 160], [1_900_000, 2_000_000], [0.3, 0.3]] as const) {
      const s = niceScale(max);
      expect(s.max).toBeCloseTo(top, 9);
      expect(s.ticks[0]).toBe(0);
      expect(s.ticks[2]).toBeCloseTo(top, 9);
      expect(s.ticks[1]).toBeCloseTo(top / 2, 9);
    }
  });
  it('con enteros forzados nunca saca 0.5', () => {
    expect(niceScale(3, { entero: true }).ticks).toEqual([0, 2, 4]);
    expect(niceScale(1, { entero: true }).ticks.every(Number.isInteger)).toBe(true);
  });
  it('máximo 0 o inválido: eje [0, mitad, tope] sin dividir entre cero', () => {
    expect(niceScale(0).max).toBe(1);
    expect(niceScale(Number.NaN, { entero: true }).ticks).toEqual([0, 1, 2]);
  });
  it('esConteoPequeno distingue conteos de importes', () => {
    expect(esConteoPequeno([1, 4, 8, null])).toBe(true);
    expect(esConteoPequeno([1, 40])).toBe(false);
    expect(esConteoPequeno([1.5, 2])).toBe(false);
    expect(esConteoPequeno([])).toBe(false);
  });
});

describe('geometriaColumnas y cadaCuantas', () => {
  it('barra/hueco 0.6, tope de 22 px, mínimo de 3 px', () => {
    expect(geometriaColumnas(8, 800).ancho).toBe(22);
    expect(geometriaColumnas(8, 80).ancho).toBeCloseTo(6, 9);
    expect(geometriaColumnas(100, 100).ancho).toBe(3);
    const g = geometriaColumnas(4, 400);
    expect(g.desfase).toBeCloseTo((100 - 22) / 2, 9);
  });
  it('las etiquetas del eje X no se pisan', () => {
    expect(cadaCuantas(8, 600, 34)).toBe(1);
    expect(cadaCuantas(60, 300, 34)).toBeGreaterThan(1);
  });
});

describe('variacionVsAnterior: solo entre periodos completos con base > 0', () => {
  const p = [{ valor: 100 }, { valor: 150 }, { valor: 120, parcial: true }, { valor: 0 }, { valor: 5 }, { valor: null }];
  it('calcula el cambio relativo con signo y coma decimal de es-MX', () => {
    expect(variacionVsAnterior(p, 1)).toEqual({ dir: 'up', texto: '+50.0 %' });
  });
  it('un periodo parcial (en cualquiera de los dos lados), base 0 o sin dato ⇒ null', () => {
    expect(variacionVsAnterior(p, 2)).toBeNull();
    expect(variacionVsAnterior(p, 3)).toBeNull();
    expect(variacionVsAnterior(p, 4)).toBeNull();
    expect(variacionVsAnterior(p, 5)).toBeNull();
    expect(variacionVsAnterior(p, 0)).toBeNull();
  });
  it('baja y estable', () => {
    expect(variacionVsAnterior([{ valor: 200 }, { valor: 150 }], 1)).toEqual({ dir: 'down', texto: '−25.0 %' });
    expect(variacionVsAnterior([{ valor: 200 }, { valor: 200 }], 1)?.dir).toBe('flat');
  });
});

describe('indicesEtiquetados', () => {
  it('el máximo y el último completo; si están cerca solo el último', () => {
    expect(indicesEtiquetados([{ valor: 1 }, { valor: 9 }, { valor: 2 }, { valor: 3 }, { valor: 4 }, { valor: 5 }])).toEqual([1, 5]);
    expect(indicesEtiquetados([{ valor: 1 }, { valor: 2 }, { valor: 9 }, { valor: 3 }])).toEqual([3]);
  });
  it('ignora parcial y nulos', () => {
    expect(indicesEtiquetados([{ valor: 5 }, { valor: 2 }, { valor: null }, { valor: 99, parcial: true }])).toEqual([1]);
    expect(indicesEtiquetados([{ valor: null }])).toEqual([]);
  });
});

describe('colocarLado', () => {
  const base = { w: 200, h: 80, vw: 1000, vh: 800 };
  it('a la derecha del punto cuando cabe', () => {
    const c = colocarLado({ ...base, ax: 100, ay: 300 });
    expect(c.lado).toBe('derecha');
    expect(c.x).toBe(114);
  });
  it('se voltea a la izquierda si no cabe a la derecha', () => {
    const c = colocarLado({ ...base, ax: 900, ay: 300 });
    expect(c.lado).toBe('izquierda');
    expect(c.x).toBe(900 - 14 - 200);
  });
  it('nunca se sale del viewport', () => {
    const c = colocarLado({ ...base, ax: 995, ay: 2, sep: 50 });
    expect(c.x).toBeGreaterThanOrEqual(8);
    expect(c.x + 200).toBeLessThanOrEqual(992);
    expect(c.y).toBeGreaterThanOrEqual(8);
    const d = colocarLado({ ...base, ax: 10, ay: 799 });
    expect(d.y + 80).toBeLessThanOrEqual(792);
  });
});

describe('ranuraEn', () => {
  it('mapea una coordenada a su ranura y acota los bordes', () => {
    expect(ranuraEn(0, 4, 400)).toBe(0);
    expect(ranuraEn(399, 4, 400)).toBe(3);
    expect(ranuraEn(-20, 4, 400)).toBe(0);
    expect(ranuraEn(900, 4, 400)).toBe(3);
    expect(ranuraEn(10, 0, 400)).toBe(-1);
  });
});
