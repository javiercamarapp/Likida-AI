import { describe, expect, it } from 'vitest';
import { celdaCsv, idsSinTextos } from './csv_prospectos';

describe('A37-S06-03: celdaCsv neutraliza fórmulas de hoja de cálculo', () => {
  it.each(['=HYPERLINK("http://x.test","a")', '+cmd|calc', '-2+3', '@SUM(A1)', '\tfoo', '\rfoo'])(
    'antepone una comilla simple a %j',
    (v) => {
      expect(celdaCsv(v).startsWith(`"'`)).toBe(true);
    },
  );
  it('el texto normal y los números no cambian; las comillas se duplican', () => {
    expect(celdaCsv('Transportes SA')).toBe('"Transportes SA"');
    expect(celdaCsv(42)).toBe('"42"');
    expect(celdaCsv(null)).toBe('""');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
  });
  it('un número negativo (lat/lng) NO se toca: no es texto del prospecto', () => {
    expect(celdaCsv(-99.13)).toBe('"-99.13"');
  });
});

describe('A37-S06-06: idsSinTextos detecta los ids sin textos tras pedirlos', () => {
  it('cuenta los ids que no llegaron', () => {
    const mapa = new Map([['a', {}], ['c', {}]]);
    expect(idsSinTextos(['a', 'b', 'c', 'd'], mapa)).toEqual(['b', 'd']);
  });
  it('todo presente = lista vacía', () => {
    expect(idsSinTextos(['a'], new Map([['a', {}]]))).toEqual([]);
  });
});
