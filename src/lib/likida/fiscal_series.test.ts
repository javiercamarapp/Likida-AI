// ═══════════════════════════════════════════════════════════════════════════
// `getGastosFiscalesSeries` — las 3 ventanas que "En riesgo/perdido" y
// "Recuperable pidiendo factura" ciclan con sus flechas ‹ › en el Resumen
// del dueño (`MotorFiscalPeriodo`, 8-ago-2026). Lo que se prueba: los
// límites de fecha de cada ventana, no `resumirPerdidas` (ya cubierta a
// fondo en `fiscal.test.ts`) ni el mapeo fila-a-fila de `getGastosFiscales`
// (sin test dedicado en este repo — se confía en `traerTodo`/`exigir`,
// probados aparte).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';

const llamadas: Array<{ tabla: string; gte?: [string, unknown]; lte?: [string, unknown] }> = [];

function mockPaginado(tabla: string) {
  const registro: { tabla: string; gte?: [string, unknown]; lte?: [string, unknown] } = { tabla };
  llamadas.push(registro);
  const b = {
    select: () => b,
    eq: () => b,
    gte: (col: string, val: unknown) => { registro.gte = [col, val]; return b; },
    lte: (col: string, val: unknown) => { registro.lte = [col, val]; return b; },
    order: () => b,
    range: () => Promise.resolve({ data: [], error: null, count: undefined }),
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (tabla: string) => mockPaginado(tabla) }) }));

const { getGastosFiscalesSeries } = await import('./fiscal');

describe('getGastosFiscalesSeries', () => {
  it('semanal pide los últimos 7 días (desde=hoy-6, hasta=hoy)', async () => {
    llamadas.length = 0;
    await getGastosFiscalesSeries('t1', '2026-08-08');
    const gasto = llamadas.filter((l) => l.tabla === 'gasto');
    expect(gasto[0].gte).toEqual(['fecha', '2026-08-02']);
    expect(gasto[0].lte).toEqual(['fecha', '2026-08-08']);
  });

  it('mensual pide los últimos 30 días (desde=hoy-29, hasta=hoy)', async () => {
    llamadas.length = 0;
    await getGastosFiscalesSeries('t1', '2026-08-08');
    const gasto = llamadas.filter((l) => l.tabla === 'gasto');
    expect(gasto[1].gte).toEqual(['fecha', '2026-07-10']);
    expect(gasto[1].lte).toEqual(['fecha', '2026-08-08']);
  });

  it('histórico no manda cota — mismo criterio que resolverPeriodo(\'todo\')', async () => {
    llamadas.length = 0;
    await getGastosFiscalesSeries('t1', '2026-08-08');
    const gasto = llamadas.filter((l) => l.tabla === 'gasto');
    expect(gasto[2].gte).toBeUndefined();
    expect(gasto[2].lte).toBeUndefined();
  });

  it('devuelve las 3 llaves, cada una un arreglo (aunque venga vacío)', async () => {
    const r = await getGastosFiscalesSeries('t1', '2026-08-08');
    expect(r).toHaveProperty('semanal');
    expect(r).toHaveProperty('mensual');
    expect(r).toHaveProperty('historico');
    expect(Array.isArray(r.semanal)).toBe(true);
  });
});
