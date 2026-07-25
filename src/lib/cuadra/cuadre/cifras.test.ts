import { describe, it, expect } from 'vitest';
import { tieneCifrasDeDinero } from './cifras';

describe('tieneCifrasDeDinero', () => {
  it('detecta cifras de dinero', () => {
    expect(tieneCifrasDeDinero('Comprobado: $6,850')).toBe(true);
    expect(tieneCifrasDeDinero('Diferencia $650 a favor')).toBe(true);
    expect(tieneCifrasDeDinero('5700.00 pesos')).toBe(true);
    expect(tieneCifrasDeDinero('anticipo 10,600')).toBe(true);
  });
  it('NO marca conteos, folios ni años', () => {
    expect(tieneCifrasDeDinero('Recibí 2 comprobantes')).toBe(false);
    expect(tieneCifrasDeDinero('viaje VJ-2026-0847')).toBe(false);
    expect(tieneCifrasDeDinero('folio 7318052')).toBe(false);
    expect(tieneCifrasDeDinero('¿ya terminaste de mandar?')).toBe(false);
  });
});
