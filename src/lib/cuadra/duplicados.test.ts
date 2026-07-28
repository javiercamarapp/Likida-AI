import { describe, it, expect } from 'vitest';
import { detectarDuplicadosEntreViajes, type FilaGasto } from './duplicados';

// El fraude número uno del sector: el mismo comprobante liquidado en DOS viajes.
// El motor de cuadre ya detecta duplicados DENTRO de un viaje; esto los detecta
// ENTRE viajes, que es donde no hay nada que los frene — cada liquidación se ve
// impecable por separado.
const f = (viaje: string, p: Partial<FilaGasto> = {}): FilaGasto => ({
  viajeId: viaje, concepto: 'diesel', monto: 1000, ...p,
});

describe('detectarDuplicadosEntreViajes', () => {
  it('el mismo CFDI en dos viajes es una anomalía', () => {
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'uuid-a' }),
      f('v2', { cfdiUuid: 'uuid-a' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe('cfdi_duplicado');
    expect(r[0].viajes.sort()).toEqual(['v1', 'v2']);
  });

  it('el mismo CFDI dos veces en EL MISMO viaje no es cosa de aquí', () => {
    // Eso ya lo atrapa el motor de cuadre y lo excluye del total. Reportarlo
    // aquí otra vez sería ruido en la bandeja del contralor.
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'uuid-a' }),
      f('v1', { cfdiUuid: 'uuid-a' }),
    ]);
    expect(r).toHaveLength(0);
  });

  it('detecta el ticket SIN CFDI repetido entre viajes', () => {
    // La mitad que faltaba. En una flota la mayoría de los gastos son tickets sin
    // timbrar todavía: si solo se vigila el UUID, el fraude más fácil de cometer
    // es el que no se mira.
    const r = detectarDuplicadosEntreViajes([
      f('v1', { folio: 'A-991', monto: 2500 }),
      f('v2', { folio: 'A-991', monto: 2500 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe('folio_duplicado');
    expect(r[0].monto).toBe(2500);
  });

  it('mismo folio con OTRO monto o concepto no se acusa', () => {
    // Los folios se repiten entre estaciones distintas: "A-991" de una gasolinera
    // y "A-991" de otra son comprobantes legítimos. Acusar a un operador de
    // fraude por una coincidencia de numeración es peor que no detectarlo.
    const r = detectarDuplicadosEntreViajes([
      f('v1', { folio: 'A-991', monto: 2500 }),
      f('v2', { folio: 'A-991', monto: 1800 }),
    ]);
    expect(r).toHaveLength(0);
  });

  it('reporta el monto REAL del comprobante duplicado', () => {
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'u', monto: 3200 }),
      f('v2', { cfdiUuid: 'u', monto: 3200 }),
    ]);
    expect(r[0].monto).toBe(3200);
  });

  it('el mismo comprobante en TRES viajes se reporta una vez, con los tres', () => {
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'u' }), f('v2', { cfdiUuid: 'u' }), f('v3', { cfdiUuid: 'u' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].viajes).toHaveLength(3);
  });

  it('sin datos no inventa anomalías', () => {
    expect(detectarDuplicadosEntreViajes([])).toEqual([]);
    expect(detectarDuplicadosEntreViajes([f('v1'), f('v2')])).toEqual([]); // sin folio ni uuid
  });
});
