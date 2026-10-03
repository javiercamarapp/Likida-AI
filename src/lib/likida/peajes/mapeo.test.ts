import { describe, it, expect } from 'vitest';
import { validarMapeo, resolverMapeo, sugerirColumnas, indiceDeLetra, listarEncabezados, letraDe } from './mapeo';

describe('validarMapeo', () => {
  it('acepta lo mínimo y limpia espacios', () => {
    const r = validarMapeo({ fecha: ' Fecha de cobro ', caseta: 'Plaza', monto: 'Importe' });
    expect(r).toEqual({ ok: true, mapeo: { fecha: 'Fecha de cobro', caseta: 'Plaza', monto: 'Importe' } });
  });
  it('exige fecha, caseta e importe, y dice cuáles faltan', () => {
    const r = validarMapeo({ caseta: 'Plaza' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/fecha, monto/);
  });
  it('rechaza no-objetos, tipos raros y textos enormes', () => {
    expect(validarMapeo(null).ok).toBe(false);
    expect(validarMapeo([]).ok).toBe(false);
    expect(validarMapeo('x').ok).toBe(false);
    expect(validarMapeo({ fecha: 3, caseta: 'a', monto: 'b' }).ok).toBe(false);
    expect(validarMapeo({ fecha: 'x'.repeat(81), caseta: 'a', monto: 'b' }).ok).toBe(false);
  });
  it('la misma columna no puede ser dos campos', () => {
    const r = validarMapeo({ fecha: 'Importe', caseta: 'Plaza', monto: 'importe' });
    expect(r.ok).toBe(false);
  });
  it('hora y tag opcionales', () => {
    const r = validarMapeo({ fecha: 'A', caseta: 'B', monto: 'C', hora: 'Hora', tag: 'TAG' });
    expect(r.ok && r.mapeo.hora).toBe('Hora');
  });
});

describe('indiceDeLetra', () => {
  it('A=0, Z=25, AA=26', () => {
    expect(indiceDeLetra('A')).toBe(0);
    expect(indiceDeLetra('z')).toBe(25);
    expect(indiceDeLetra('AA')).toBe(26);
    expect(indiceDeLetra('AAA')).toBeNull();
    expect(indiceDeLetra('1')).toBeNull();
    expect(letraDe(0)).toBe('A');
    expect(letraDe(27)).toBe('AB');
  });
});

describe('resolverMapeo', () => {
  const enc = ['Folio', 'Fecha de cobro', 'Hora', 'Plaza', 'Importe', 'No. TAG'];
  it('por encabezado (sin importar acentos ni mayúsculas)', () => {
    const r = resolverMapeo(enc, { fecha: 'fecha DE cobro', caseta: 'plaza', monto: 'IMPORTE', hora: 'hora', tag: 'no tag' });
    expect(r).toEqual({ ok: true, columnas: { fecha: 1, caseta: 3, monto: 4, hora: 2, tag: 5 } });
  });
  it('por letra de columna', () => {
    const r = resolverMapeo(enc, { fecha: 'B', caseta: 'D', monto: 'E' });
    expect(r).toEqual({ ok: true, columnas: { fecha: 1, caseta: 3, monto: 4 } });
  });
  it('un encabezado que se llama como una letra gana a la letra', () => {
    const r = resolverMapeo(['A', 'B', 'C', 'Importe'], { fecha: 'B', caseta: 'C', monto: 'Importe' });
    expect(r.ok && r.columnas).toEqual({ fecha: 1, caseta: 2, monto: 3 });
  });
  it('lo que no está se reporta con lo declarado', () => {
    const r = resolverMapeo(enc, { fecha: 'Fecha', caseta: 'Plaza', monto: 'Total' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.noEncontradas.map((n) => n.campo)).toEqual(['fecha', 'monto']);
  });
  it('una letra fuera del archivo no resuelve', () => {
    const r = resolverMapeo(['a', 'b'], { fecha: 'A', caseta: 'B', monto: 'Z' });
    expect(r.ok).toBe(false);
  });
  it('dos campos apuntando a la misma columna no resuelven', () => {
    const r = resolverMapeo(enc, { fecha: 'B', caseta: 'Fecha de cobro', monto: 'E' });
    expect(r.ok).toBe(false);
  });
});

describe('sugerirColumnas — solo SUGIERE', () => {
  it('detecta typos y variantes cercanas', () => {
    expect(sugerirColumnas('monto', ['Fecha', 'Improte', 'Plaza'])).toEqual(['Improte']);
    expect(sugerirColumnas('caseta', ['Fecha', 'Casetta', 'X'])).toEqual(['Casetta']);
  });
  it('no inventa nada cuando no hay parecido', () => {
    expect(sugerirColumnas('monto', ['Fecha', 'Plaza', 'Km'])).toEqual([]);
  });
  it('listarEncabezados trae la letra', () => {
    expect(listarEncabezados(['Fecha', '', 'Importe'])).toBe('A=«Fecha», C=«Importe»');
  });
});
