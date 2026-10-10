import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conPoligonoOCirculo, faltaColumnaPoligono, geometriaDeFila, reiniciarMemoriaPoligono } from './geometria_datos';

const ERR_COLUMNA = { code: '42703', message: 'column geocerca.poligono does not exist' };
const T0 = 1_000_000;

beforeEach(() => reiniciarMemoriaPoligono());

describe('faltaColumnaPoligono: solo el error de la columna de la 0630, ningún otro', () => {
  it('reconoce 42703 y PGRST204 de poligono/aproximada', () => {
    expect(faltaColumnaPoligono(ERR_COLUMNA)).toBe(true);
    expect(faltaColumnaPoligono({ code: 'PGRST204', message: "Could not find the 'aproximada' column of 'geocerca' in the schema cache" })).toBe(true);
  });
  it('NO traga otros fallos', () => {
    expect(faltaColumnaPoligono(null)).toBe(false);
    expect(faltaColumnaPoligono({ code: '57014', message: 'statement timeout' })).toBe(false);
    expect(faltaColumnaPoligono({ code: '42703', message: 'column geocerca.radio_m does not exist' })).toBe(false);
    expect(faltaColumnaPoligono({ code: '42501', message: 'permission denied for table geocerca (poligono)' })).toBe(false);
  });
});

describe('conPoligonoOCirculo: respaldo contra una base sin la 0630', () => {
  it('con la migración aplicada, una sola consulta (con polígono)', async () => {
    const q = vi.fn(async (_c: boolean) => ({ data: [1], error: null }));
    const r = await conPoligonoOCirculo(q, T0);
    expect(r.data).toEqual([1]);
    expect(q.mock.calls).toEqual([[true]]);
  });
  it('sin la migración repite SIN las columnas y lo recuerda 5 min (no repite la consulta fallida)', async () => {
    const q = vi.fn(async (c: boolean) => (c ? { data: null, error: ERR_COLUMNA } : { data: [2], error: null }));
    expect((await conPoligonoOCirculo(q, T0)).data).toEqual([2]);
    expect(q.mock.calls).toEqual([[true], [false]]);
    q.mockClear();
    expect((await conPoligonoOCirculo(q, T0 + 60_000)).data).toEqual([2]);
    expect(q.mock.calls).toEqual([[false]]);
    q.mockClear();
    await conPoligonoOCirculo(q, T0 + 6 * 60_000); // pasados los 5 min vuelve a intentar con polígono
    expect(q.mock.calls[0]).toEqual([true]);
  });
  it('otro error NO se esconde: se devuelve tal cual, sin segunda consulta', async () => {
    const q = vi.fn(async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }));
    const r = await conPoligonoOCirculo(q, T0);
    expect(r.error?.code).toBe('57014');
    expect(q).toHaveBeenCalledTimes(1);
  });
});

describe('geometriaDeFila', () => {
  const patio = [{ lat: 20, lng: -103 }, { lat: 20, lng: -102.99 }, { lat: 20.01, lng: -102.99 }];
  it('polígono válido: lo devuelve y no es aproximada aunque la fila diga lo contrario', () => {
    expect(geometriaDeFila({ poligono: patio, aproximada: true })).toEqual({ poligono: patio, aproximada: false });
  });
  it('sin polígono: círculo; aproximada solo si la fila lo declara', () => {
    expect(geometriaDeFila({ poligono: null, aproximada: true })).toEqual({ poligono: null, aproximada: true });
    expect(geometriaDeFila({})).toEqual({ poligono: null, aproximada: false });
  });
  it('un polígono roto en la base NO se usa (cae a círculo)', () => {
    expect(geometriaDeFila({ poligono: [{ lat: 20, lng: -103 }], aproximada: false })).toEqual({ poligono: null, aproximada: false });
  });
});
