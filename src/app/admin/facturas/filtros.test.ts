import { describe, expect, it } from 'vitest';
import { fechaValida, leerFiltros, rangoAlReves } from './filtros';

describe('filtros de facturas', () => {
  it('acepta un estado conocido y fechas reales', () => {
    expect(leerFiltros({ estado: 'pagada', desde: '2026-01-01', hasta: '2026-06-30' })).toEqual({ estado: 'pagada', desde: '2026-01-01', hasta: '2026-06-30' });
  });
  it('descarta lo que no es un estado conocido ni una fecha real (nada raro llega a la base)', () => {
    expect(leerFiltros({ estado: 'x; drop', desde: '2026-02-30', hasta: 'mañana' })).toEqual({});
    expect(leerFiltros({ estado: ['pagada'], desde: 20260101 })).toEqual({});
  });
  it('fechaValida rechaza formatos que no son AAAA-MM-DD', () => {
    expect(fechaValida('2026-1-1')).toBeUndefined();
    expect(fechaValida('2026-02-29')).toBeUndefined();
    expect(fechaValida('2028-02-29')).toBe('2028-02-29');
  });
  it('detecta un rango al revés', () => {
    expect(rangoAlReves({ desde: '2026-06-01', hasta: '2026-01-01' })).toBe(true);
    expect(rangoAlReves({ desde: '2026-01-01', hasta: '2026-01-01' })).toBe(false);
    expect(rangoAlReves({ desde: '2026-01-01' })).toBe(false);
  });
});
