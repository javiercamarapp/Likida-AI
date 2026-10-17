import { describe, it, expect } from 'vitest';
import { elegirDestinatarios, MAX_DESTINOS_POR_NIVEL, nivelesSinDestino, rotuloDeNivel, type ContactoTrafico } from './escalamiento';

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

describe('niveles sin a quién avisar (T-A5-23)', () => {
  it('terminal con contacto de nivel 1 → ese contacto avisa; el nivel 1 no falta', () => {
    expect(elegirDestinatarios([c(1, T1, '5211')], null, T1, 1).map((d) => d.telefono)).toEqual(['5211']);
    expect(nivelesSinDestino([c(1, T1, '5211'), c(2, null, '5299')], null, T1, 'Norte').map((f) => f.nivel)).toEqual([]);
  });

  it('terminal sin contacto cae al nivel 1 de toda la flota: no hay hueco', () => {
    expect(elegirDestinatarios([c(1, null, '5213')], null, T1, 1).map((d) => d.telefono)).toEqual(['5213']);
    expect(nivelesSinDestino([c(1, null, '5213'), c(2, null, '5299')], null, T1, 'Norte')).toEqual([]);
  });

  it('sin ningún contacto ni jefe de la flota: ambos niveles son hueco y el texto dice qué hacer', () => {
    const r = nivelesSinDestino([], null, T1, 'Norte');
    expect(r.map((f) => f.nivel)).toEqual([1, 2]);
    expect(r[0].texto).toBe('El nivel 1 (Patio responsable) de Norte no tiene a quién avisar. Agrega un contacto en Configuración.');
  });

  it('el jefe de la flota de respaldo tapa el hueco', () => {
    expect(nivelesSinDestino([], '5200', T1, 'Norte')).toEqual([]);
  });

  it('el rótulo del nivel es el configurado por la flota; sin él, el de siempre', () => {
    expect(rotuloDeNivel(1)).toBe('Patio responsable');
    expect(rotuloDeNivel(2, { 2: '  Jefe   de flota ' })).toBe('Jefe de flota');
    expect(rotuloDeNivel(1, { 1: '   ' })).toBe('Patio responsable');
    const r = nivelesSinDestino([], null, null, null, { 1: 'Jefe de tráfico' });
    expect(r[0].texto).toBe('El nivel 1 (Jefe de tráfico) de la flota no tiene a quién avisar. Agrega un contacto en Configuración.');
  });

  it('el mismo teléfono en nivel 1 y 2 solo recibe el 1', () => {
    const contactos = [c(1, null, '523312345678'), c(2, null, '523312345678')]; // grep-limpio:ok
    const n1 = elegirDestinatarios(contactos, null, T1, 1);
    expect(n1).toHaveLength(1);
    expect(elegirDestinatarios(contactos, null, T1, 2, n1.map((d) => d.telefono))).toEqual([]);
  });

  it('un teléfono con la marca de demo 28999 no cuenta como a quién avisar', () => {
    expect(nivelesSinDestino([c(1, null, '289991234567'), c(2, null, '289991234568')], '28999000111', T1, 'Norte').map((f) => f.nivel)).toEqual([1, 2]);
  });

  it('se respeta MAX_DESTINOS_POR_NIVEL con contactos de sobra', () => {
    const muchos = Array.from({ length: MAX_DESTINOS_POR_NIVEL + 4 }, (_, i) => c(1, T1, `52331234567${i}`));
    expect(elegirDestinatarios(muchos, null, T1, 1)).toHaveLength(MAX_DESTINOS_POR_NIVEL);
  });
});
