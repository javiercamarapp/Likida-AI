import { describe, it, expect } from 'vitest';
import { tieneCifrasDeDinero } from './cifras';

describe('tieneCifrasDeDinero', () => {
  it('detecta cifras de dinero', () => {
    expect(tieneCifrasDeDinero('Comprobado: $6,850')).toBe(true);
    expect(tieneCifrasDeDinero('Diferencia $650 a favor')).toBe(true);
    expect(tieneCifrasDeDinero('5700.00 pesos')).toBe(true);
    expect(tieneCifrasDeDinero('anticipo 10,600')).toBe(true);
  });

  // Enteros redondos SIN $ ni coma: el LLM alucina "sobraron 500 pesos" y antes
  // pasaba la guardia. Ahora se detectan por la palabra-moneda adyacente.
  it('detecta enteros redondos pegados a palabra de dinero', () => {
    expect(tieneCifrasDeDinero('sobraron 500 pesos')).toBe(true);
    expect(tieneCifrasDeDinero('comprobaste 8000')).toBe(true);
    expect(tieneCifrasDeDinero('sobró 500 del anticipo')).toBe(true);
    expect(tieneCifrasDeDinero('te quedan 1500 a favor')).toBe(true);
    expect(tieneCifrasDeDinero('faltan 300 por comprobar')).toBe(true);
  });
  it('NO marca conteos, folios ni años', () => {
    expect(tieneCifrasDeDinero('Recibí 2 comprobantes')).toBe(false);
    expect(tieneCifrasDeDinero('viaje VJ-2026-0847')).toBe(false);
    expect(tieneCifrasDeDinero('folio 7318052')).toBe(false);
    expect(tieneCifrasDeDinero('¿ya terminaste de mandar?')).toBe(false);
  });

  // No-regresión: mensajes legítimos que NO deben forzar el cuadre (founder).
  it('NO se dispara con mensajes legítimos sin monto', () => {
    expect(tieneCifrasDeDinero('Recibí tus 8 comprobantes')).toBe(false);
    expect(tieneCifrasDeDinero('Llevas 3 tickets de caseta')).toBe(false);
    expect(tieneCifrasDeDinero('Tu viaje V-2841 sigue abierto')).toBe(false);
    expect(tieneCifrasDeDinero('Mándalos todos y escribe listo')).toBe(false);
  });
});
