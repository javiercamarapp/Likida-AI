import { describe, it, expect } from 'vitest';
import { estaEnPadronMonederos, emisorMonedero } from './padron_monederos';

describe('padron_monederos — FASE 2, la semilla de emisores', () => {
  it('reconoce un RFC de la semilla, insensible a mayúsculas y espacios', () => {
    expect(estaEnPadronMonederos('EFE8908015L3')).toBe(true);
    expect(estaEnPadronMonederos('efe8908015l3')).toBe(true);
    expect(estaEnPadronMonederos('  EFE8908015L3  ')).toBe(true);
  });

  it('un RFC fuera de la semilla da false — que NO es "no es monedero", ver el aviso del módulo', () => {
    expect(estaEnPadronMonederos('XXX010101XX1')).toBe(false);
  });

  it('sin RFC (undefined/null/vacío) → false, no lanza', () => {
    expect(estaEnPadronMonederos(undefined)).toBe(false);
    expect(estaEnPadronMonederos(null)).toBe(false);
    expect(estaEnPadronMonederos('')).toBe(false);
  });

  it('emisorMonedero devuelve el emisor completo para mostrar en el panel', () => {
    const e = emisorMonedero('PUN9810229R0');
    expect(e).toMatchObject({ emisor: 'Sí Vale México, S.A. de C.V.' });
    expect(e?.producto).toContain('Diesel Fleet');
  });

  it('emisorMonedero fuera de la semilla → undefined', () => {
    expect(emisorMonedero('XXX010101XX1')).toBeUndefined();
  });
});
