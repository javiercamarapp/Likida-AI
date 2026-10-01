import { describe, it, expect } from 'vitest';
import { elegirDestinatarios, MAX_DESTINOS_POR_NIVEL, type ContactoTrafico } from './escalamiento';

const T1 = '38000000-0000-4000-8000-0000000000a5';
const T2 = '38000000-0000-4000-8000-0000000000a6';
const c = (nivel: 1 | 2, terminalId: string | null, telefono: string, nombre = `c${telefono}`): ContactoTrafico => ({ nivel, terminalId, telefono, nombre });

describe('a quién se escala', () => {
  it('nivel 1: el patio de la terminal del viaje', () => {
    const r = elegirDestinatarios([c(1, T1, '5211'), c(1, T2, '5212'), c(2, null, '5299')], '5200', T1, 1);
    expect(r.map((d) => d.telefono)).toEqual(['5211']);
  });

  it('nivel 1 sin patio en esa terminal cae al patio de TODA la flota', () => {
    const r = elegirDestinatarios([c(1, null, '5213'), c(1, T2, '5212')], '5200', T1, 1);
    expect(r.map((d) => d.telefono)).toEqual(['5213']);
  });

  it('nivel 1 sin patio configurado cae al jefe general configurado y, sin él, al jefe de la flota', () => {
    expect(elegirDestinatarios([c(2, null, '5299')], '5200', T1, 1).map((d) => d.telefono)).toEqual(['5299']);
    const r = elegirDestinatarios([], '5200', T1, 1);
    expect(r).toEqual([{ nombre: 'Jefe de la flota', telefono: '5200' }]);
  });

  it('nivel 2: el jefe general', () => {
    expect(elegirDestinatarios([c(1, T1, '5211'), c(2, null, '5299')], '5200', T1, 2).map((d) => d.telefono)).toEqual(['5299']);
  });

  it('un teléfono que ya recibió el nivel 1 NO recibe el 2 (subir a la misma persona no escala nada)', () => {
    expect(elegirDestinatarios([], '5200', T1, 2, ['5200'])).toEqual([]);
    expect(elegirDestinatarios([c(2, null, '5299')], '5200', T1, 2, ['5299'])).toEqual([]);
  });

  it('compara teléfonos normalizados (521 + 10 dígitos = 52 + 10)', () => {
    expect(elegirDestinatarios([c(2, null, '525512345678')], null, null, 2, ['5215512345678'])).toEqual([]);
  });

  it('sin contactos ni jefe no hay a quién', () => {
    expect(elegirDestinatarios([], null, T1, 1)).toEqual([]);
  });

  it('sin duplicados y con tope por nivel', () => {
    const muchos = [1, 2, 3, 4, 5].map((i) => c(1, T1, `521100000${i}`));
    expect(elegirDestinatarios([...muchos, c(1, T1, '5211000001')], null, T1, 1)).toHaveLength(MAX_DESTINOS_POR_NIVEL);
    expect(elegirDestinatarios([c(1, T1, '5211'), c(1, T1, '5211')], null, T1, 1)).toHaveLength(1);
  });

  it('un contacto de OTRA terminal no se usa cuando la del viaje tiene el suyo', () => {
    const r = elegirDestinatarios([c(1, T2, '5212'), c(1, T1, '5211')], null, T1, 1);
    expect(r.map((d) => d.telefono)).toEqual(['5211']);
  });
});
