import { describe, it, expect } from 'vitest';
import { elegirConvenio, ladoActual, type ConvenioCandidato } from './seleccion';

const C = (id: string, o: Partial<ConvenioCandidato> = {}): ConvenioCandidato => ({
  id, nombre: id, activo: true, origen: null, destino: null, origenSitioId: null, destinoSitioId: null,
  vigenteDesde: null, vigenteHasta: null, instrucciones: [], ...o,
});
const V = { origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', origenSitioId: null, destinoSitioId: null };
const HOY = '2026-10-10';

describe('elegirConvenio', () => {
  it('sin convenios, ninguno', () => expect(elegirConvenio([], V, HOY)).toEqual({ tipo: 'ninguno', motivo: 'sin_convenios' }));

  it('un solo convenio vigente es «el convenio del cliente» aunque no coincida en texto', () => {
    expect(elegirConvenio([C('a')], V, HOY)).toMatchObject({ tipo: 'elegido', puntos: 0 });
  });

  it('descarta inactivos y vencidos', () => {
    const r = elegirConvenio([C('a', { activo: false }), C('b', { vigenteHasta: '2026-10-09' }), C('c', { vigenteDesde: '2026-10-11' })], V, HOY);
    expect(r).toEqual({ tipo: 'ninguno', motivo: 'sin_vigentes' });
    expect(elegirConvenio([C('a', { vigenteDesde: '2026-10-10', vigenteHasta: '2026-10-10' })], V, HOY).tipo).toBe('elegido');
  });

  it('manda el que más coincide; el sitio de catálogo pesa más que el texto', () => {
    const r = elegirConvenio([
      C('texto', { destino: 'cedis  tlaquepaque' }),
      C('sitio', { destinoSitioId: 'g1' }),
    ], { ...V, destinoSitioId: 'g1' }, HOY);
    expect(r).toMatchObject({ tipo: 'elegido', convenio: { id: 'sitio' }, puntos: 3 });
  });

  it('un convenio que apunta a OTRA planta que la del viaje se descarta', () => {
    const r = elegirConvenio([C('otra', { destinoSitioId: 'g2' })], { ...V, destinoSitioId: 'g1' }, HOY);
    expect(r).toEqual({ tipo: 'ninguno', motivo: 'contradice_al_viaje' });
  });

  it('varios empatados sin coincidencia: NO adivina', () => {
    const r = elegirConvenio([C('a'), C('b')], V, HOY);
    expect(r).toEqual({ tipo: 'ambiguo', candidatos: ['a', 'b'] });
  });

  it('empatados pero con coincidencia: gana el que coincide más', () => {
    const r = elegirConvenio([C('a'), C('b', { origen: 'Planta Zapopan' })], V, HOY);
    expect(r).toMatchObject({ tipo: 'elegido', convenio: { id: 'b' } });
  });
});

describe('ladoActual', () => {
  it('antes de salir de la carga, la planta es la de origen; después, la de destino', () => {
    expect(ladoActual({ llegadaCarga: false, salidaCarga: false })).toBe('origen');
    expect(ladoActual({ llegadaCarga: true, salidaCarga: false })).toBe('origen');
    expect(ladoActual({ llegadaCarga: true, salidaCarga: true })).toBe('destino');
  });
});

describe('texto distinto también contradice (ronda 04, adversarial)', () => {
  const c = (id: string, origen: string, destino: string): ConvenioCandidato => ({
    id, nombre: id, activo: true, origen, destino, origenSitioId: null, destinoSitioId: null, vigenteDesde: null, vigenteHasta: null, instrucciones: [],
  });
  const v = (origen: string, destino: string) => ({ origen, destino, origenSitioId: null, destinoSitioId: null });
  it('Silao→Monterrey no se le manda a un viaje Silao→Querétaro ni a Tijuana→Mérida', () => {
    expect(elegirConvenio([c('A', 'Silao', 'Monterrey')], v('Silao', 'Querétaro'), '2026-10-02')).toEqual({ tipo: 'ninguno', motivo: 'contradice_al_viaje' });
    expect(elegirConvenio([c('A', 'Silao', 'Monterrey')], v('Tijuana', 'Mérida'), '2026-10-02')).toMatchObject({ tipo: 'ninguno' });
  });
  it('con A(Silao→Monterrey) y B(León→Querétaro), Silao→Laredo no elige ninguno', () => {
    expect(elegirConvenio([c('A', 'Silao', 'Monterrey'), c('B', 'León', 'Querétaro')], v('Silao', 'Laredo'), '2026-10-02').tipo).toBe('ninguno');
  });
  it('uno contenido en el otro por palabras completas sí coincide', () => {
    expect(elegirConvenio([c('A', 'Silao', 'Monterrey')], v('Silao Guanajuato', 'Monterrey NL'), '2026-10-02')).toMatchObject({ tipo: 'elegido', puntos: 4 });
  });
});
