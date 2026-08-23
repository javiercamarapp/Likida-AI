// ═══════════════════════════════════════════════════════════════════════════
// `getTopRutasPorGasto` — la tabla "Top rutas por gasto" con región
// coloreada que volvió al Resumen el 8-ago-2026 (captura de referencia de
// Javier). Lo que se prueba: la región es un hecho geográfico REAL
// (catálogo de ciudades), nunca inventada para una ciudad que no está en
// el catálogo — y el % es del top-N devuelto, no del gasto total de la
// flota.
//
// ESCALA 50k (mig. 0150): el join gasto×viaje vive en `top_rutas_gasto_tenant`;
// el mock es el Postgres falso de la 0150 sobre las mismas tablas de antes.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rpcFalso0150, type Tablas } from './analytics_rpc_0150.fixture';

const TABLAS: Tablas = {};
const sembrar = (tabla: string, filas: Array<Record<string, unknown>>) => {
  TABLAS[tabla] = filas.map((f) => ({ tenant_id: 't1', ...f }));
};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) =>
      Promise.resolve(rpcFalso0150(fn, args, TABLAS) ?? { data: null, error: null }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getTopRutasPorGasto } = await import('./analytics');

describe('getTopRutasPorGasto', () => {
  beforeEach(() => { for (const k of Object.keys(TABLAS)) delete TABLAS[k]; });

  it('clasifica la región del DESTINO cuando está en el catálogo', async () => {
    sembrar('viaje', [{ id: 'v1', origen: 'CDMX', destino: 'Guadalajara, Jal.' }]);
    sembrar('gasto', [{ viaje_id: 'v1', monto: 1000 }]);
    const r = await getTopRutasPorGasto('t1');
    expect(r[0].region).toBe('Occidente');
  });

  it('una ciudad fuera del catálogo sale SIN región — nunca una adivinada', async () => {
    sembrar('viaje', [{ id: 'v1', origen: 'CDMX', destino: 'Pueblo Chico Desconocido' }]);
    sembrar('gasto', [{ viaje_id: 'v1', monto: 1000 }]);
    const r = await getTopRutasPorGasto('t1');
    expect(r[0].region).toBeNull();
  });

  it('busca la ciudad como SUBCADENA, sin exigir coincidencia exacta', async () => {
    sembrar('viaje', [{ id: 'v1', origen: 'X', destino: 'Monterrey, N.L.' }]);
    sembrar('gasto', [{ viaje_id: 'v1', monto: 500 }]);
    const r = await getTopRutasPorGasto('t1');
    expect(r[0].region).toBe('Noreste');
  });

  it('el % es del top-N devuelto, no del gasto total de la flota', async () => {
    sembrar('viaje', [
      { id: 'v1', origen: 'A', destino: 'Monterrey' },
      { id: 'v2', origen: 'B', destino: 'Guadalajara' },
    ]);
    sembrar('gasto', [
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
    sembrar('viaje', [
      { id: 'v1', origen: 'A', destino: 'Monterrey' },
      { id: 'v2', origen: 'B', destino: 'Guadalajara' },
      { id: 'v3', origen: 'C', destino: 'Tijuana' },
    ]);
    sembrar('gasto', [
      { viaje_id: 'v1', monto: 100 },
      { viaje_id: 'v2', monto: 200 },
      { viaje_id: 'v3', monto: 300 },
    ]);
    const r = await getTopRutasPorGasto('t1', 2);
    expect(r).toHaveLength(2);
    expect(r[0].destino).toBe('Tijuana');
  });

  it('sin gasto asociado a ninguna ruta, regresa un arreglo vacío', async () => {
    sembrar('viaje', []);
    sembrar('gasto', []);
    const r = await getTopRutasPorGasto('t1');
    expect(r).toEqual([]);
  });

  it('la ventana acota por fecha del comprobante, y sin ventana entra todo', async () => {
    sembrar('viaje', [{ id: 'v1', origen: 'A', destino: 'Monterrey' }]);
    sembrar('gasto', [
      { viaje_id: 'v1', monto: 100, fecha: '2026-01-01' },
      { viaje_id: 'v1', monto: 50, fecha: '2026-08-01' },
    ]);
    expect((await getTopRutasPorGasto('t1', 5, { desde: '2026-07-01', hasta: '2026-08-31' }))[0].total).toBe(50);
    expect((await getTopRutasPorGasto('t1', 5))[0].total).toBe(150);
  });
});
