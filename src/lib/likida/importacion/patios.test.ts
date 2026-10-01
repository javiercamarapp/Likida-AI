import { describe, it, expect } from 'vitest';
import { asignarPatios, llavePatio } from './patios';

const NORTE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nombre: 'Patio Norte', ciudad: 'Monterrey' };
const SUR = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nombre: 'Patio Sur', ciudad: null };
const patios = [NORTE, SUR];
const f = (fila: number, patio?: string | null) => ({ fila, patio, x: fila });

describe('llavePatio', () => {
  it('«Patio Norte», «patio  norte » y «PATIO NORTE» son el MISMO patio (como la unicidad de la base)', () => {
    expect(llavePatio('Patio Norte')).toBe(llavePatio('  patio   norte '));
    expect(llavePatio('PATIO NORTE')).toBe(llavePatio('Patio Norte'));
  });
});

describe('asignarPatios — con la flota entera', () => {
  const flota = { tipo: 'flota' } as const;

  it('resuelve cada nombre al uuid del patio, sin importar mayúsculas ni espacios', () => {
    const r = asignarPatios([f(2, 'Patio Norte'), f(3, ' patio  sur '), f(4, 'PATIO NORTE')], patios, flota);
    expect(r.filas.map((x) => x.terminalId)).toEqual([NORTE.id, SUR.id, NORTE.id]);
    expect(r.descartadas).toEqual([]);
  });

  it('sin patio en el archivo = sin patio (null), no un patio inventado', () => {
    const r = asignarPatios([f(2), f(3, ''), f(4, '   '), f(5, null)], patios, flota);
    expect(r.filas.map((x) => x.terminalId)).toEqual([null, null, null, null]);
  });

  it('un patio que la flota NO tiene descarta la fila y dice dónde crearlo; NO crea el patio', () => {
    const r = asignarPatios([f(2, 'Patio Nrte'), f(3, 'Patio Norte')], patios, flota);
    expect(r.filas).toHaveLength(1);
    expect(r.descartadas).toEqual([{ fila: 2, motivo: expect.stringMatching(/«Patio Nrte» no existe en tu flota. Créalo en Patios/) }]);
  });

  it('los patios desconocidos se listan UNA vez aunque se repitan en 90 filas', () => {
    const filas = Array.from({ length: 90 }, (_, i) => f(i + 2, i % 2 ? 'Patio Poniente' : ' patio poniente'));
    const r = asignarPatios(filas, patios, flota);
    expect(r.descartadas).toHaveLength(90);
    // Sale UNA vez, con la primera grafía que apareció.
    expect(r.patiosDesconocidos).toEqual(['patio poniente']);
  });

  it('conserva los demás campos de la fila', () => {
    const r = asignarPatios([f(7, 'Patio Sur')], patios, flota);
    expect(r.filas[0]).toMatchObject({ fila: 7, x: 7, terminalId: SUR.id });
  });

  it('un nombre hostil (inyección, HTML, enorme) es solo «un patio que no existe»: nunca un uuid ni un error', () => {
    const r = asignarPatios([f(2, "x'; drop table terminal;--"), f(3, '<script>alert(1)</script>'), f(4, 'p'.repeat(5000))], patios, flota);
    expect(r.filas).toEqual([]);
    expect(r.descartadas).toHaveLength(3);
  });

  it('una flota SIN patios: toda fila con patio se descarta y se dice cuál; las vacías pasan', () => {
    const r = asignarPatios([f(2, 'Patio Norte'), f(3)], [], flota);
    expect(r.filas).toHaveLength(1);
    expect(r.patiosDesconocidos).toEqual(['Patio Norte']);
  });
});

describe('asignarPatios — un jefe CON patio solo carga el suyo', () => {
  const jefe = { tipo: 'patio', terminalId: NORTE.id } as const;

  it('las filas sin patio caen en el suyo; las que nombran el suyo pasan', () => {
    const r = asignarPatios([f(2), f(3, 'patio norte')], patios, jefe);
    expect(r.filas.map((x) => x.terminalId)).toEqual([NORTE.id, NORTE.id]);
  });

  it('las que nombran OTRO patio se descartan diciendo cuál es el suyo (no se reasignan en silencio)', () => {
    const r = asignarPatios([f(2, 'Patio Sur')], patios, jefe);
    expect(r.filas).toEqual([]);
    expect(r.descartadas[0].motivo).toMatch(/«Patio Sur» no es el tuyo \(«Patio Norte»\)/);
  });

  it('un patio que no existe tampoco pasa (y no se lista como «créalo»: él no crea patios)', () => {
    const r = asignarPatios([f(2, 'Patio Fantasma')], patios, jefe);
    expect(r.filas).toEqual([]);
    expect(r.descartadas[0].motivo).toMatch(/no existe en tu flota y tu carga solo puede ser de tu patio/);
    expect(r.patiosDesconocidos).toEqual([]);
  });
});
