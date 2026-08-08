// ═══════════════════════════════════════════════════════════════════════════
// `getTopRutasPorGasto` — la tabla "Top rutas por gasto" con región
// coloreada que volvió al Resumen el 8-ago-2026 (captura de referencia de
// Javier). Lo que se prueba: la región es un hecho geográfico REAL
// (catálogo de ciudades), nunca inventada para una ciudad que no está en
// el catálogo — y el % es del top-N devuelto, no del gasto total de la
// flota.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const filasPorTabla = new Map<string, unknown[]>();

function mockPaginado(tabla: string) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => b,
    range: (desde: number, hasta: number) => Promise.resolve({
      data: (filasPorTabla.get(tabla) ?? []).slice(desde, hasta + 1), error: null, count: undefined,
    }),
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (tabla: string) => mockPaginado(tabla) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getTopRutasPorGasto } = await import('./analytics');

describe('getTopRutasPorGasto', () => {
  beforeEach(() => { filasPorTabla.clear(); });

  it('clasifica la región del DESTINO cuando está en el catálogo', async () => {
    filasPorTabla.set('viaje', [{ id: 'v1', origen: 'CDMX', destino: 'Guadalajara, Jal.' }]);
    filasPorTabla.set('gasto', [{ viaje_id: 'v1', monto: 1000 }]);
    const r = await getTopRutasPorGasto('t1');
    expect(r[0].region).toBe('Occidente');
  });

  it('una ciudad fuera del catálogo sale SIN región — nunca una adivinada', async () => {
    filasPorTabla.set('viaje', [{ id: 'v1', origen: 'CDMX', destino: 'Pueblo Chico Desconocido' }]);
    filasPorTabla.set('gasto', [{ viaje_id: 'v1', monto: 1000 }]);
    const r = await getTopRutasPorGasto('t1');
    expect(r[0].region).toBeNull();
  });

  it('busca la ciudad como SUBCADENA, sin exigir coincidencia exacta', async () => {
    filasPorTabla.set('viaje', [{ id: 'v1', origen: 'X', destino: 'Monterrey, N.L.' }]);
    filasPorTabla.set('gasto', [{ viaje_id: 'v1', monto: 500 }]);
    const r = await getTopRutasPorGasto('t1');
    expect(r[0].region).toBe('Noreste');
  });

  it('el % es del top-N devuelto, no del gasto total de la flota', async () => {
    filasPorTabla.set('viaje', [
      { id: 'v1', origen: 'A', destino: 'Monterrey' },
      { id: 'v2', origen: 'B', destino: 'Guadalajara' },
    ]);
    filasPorTabla.set('gasto', [
      { viaje_id: 'v1', monto: 300 },
      { viaje_id: 'v2', monto: 700 },
    ]);
    const r = await getTopRutasPorGasto('t1', 5);
    expect(r).toHaveLength(2);
    const total = r.reduce((s, x) => s + x.pct, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(r[0].pct).toBe(70); // Guadalajara, la de más gasto, va primero
  });

  it('respeta el tope `top` — no regresa más de las N rutas pedidas', async () => {
    filasPorTabla.set('viaje', [
      { id: 'v1', origen: 'A', destino: 'Monterrey' },
      { id: 'v2', origen: 'B', destino: 'Guadalajara' },
      { id: 'v3', origen: 'C', destino: 'Tijuana' },
    ]);
    filasPorTabla.set('gasto', [
      { viaje_id: 'v1', monto: 100 },
      { viaje_id: 'v2', monto: 200 },
      { viaje_id: 'v3', monto: 300 },
    ]);
    const r = await getTopRutasPorGasto('t1', 2);
    expect(r).toHaveLength(2);
    expect(r[0].destino).toBe('Tijuana');
  });

  it('sin gasto asociado a ninguna ruta, regresa un arreglo vacío', async () => {
    filasPorTabla.set('viaje', []);
    filasPorTabla.set('gasto', []);
    const r = await getTopRutasPorGasto('t1');
    expect(r).toEqual([]);
  });
});
