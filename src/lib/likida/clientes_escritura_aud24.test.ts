// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-9 (MEDIO, REINCIDENTE D6) — `clientes.test.ts:12-13` declara
// explícito que las escrituras «no se prueban aquí», el único módulo de
// dinero del repo con ese criterio (`saveLiquidacion`, `facturacion_escritura`
// SÍ se prueban con doble). `filaTarifa` (clientes.ts:859-865) es la única
// función que traduce `TarifaValida` a la fila que se inserta; si algún día
// `origen`/`destino` quedan invertidos ahí, `tarifaSugerida` propondría el
// precio de OTRO carril y nada lo notaría.
//
// Mismo patrón que `facturacion_escritura_cableado.test.ts`: un doble que
// CAPTURA el payload real del `.insert()`/`.update()` y afirma columna por
// columna — no un mock ciego que solo cuenta llamadas.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TarifaValida } from './clientes';

vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));

let insertado: Record<string, unknown> | null = null;
let actualizado: Record<string, unknown> | null = null;
const eqUpdate: Array<[string, unknown]> = [];

function builderTarifa() {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    insert: (fila: Record<string, unknown>) => { insertado = fila; return b; },
    update: (fila: Record<string, unknown>) => { actualizado = fila; return b; },
    eq: (col: string, v: unknown) => { eqUpdate.push([col, v]); return b; },
    select: () => b,
    single: async () => ({ data: { id: 'tarifa-1' }, error: null }),
    then: (res: (x: unknown) => unknown) => Promise.resolve({ data: [{ id: 'tarifa-1' }], error: null }).then(res),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builderTarifa() }) }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));

const { crearTarifa, editarTarifa } = await import('./clientes');

const TARIFA: TarifaValida = {
  clienteId: null, // sin cliente: no dispara clientePropio() (fuera de alcance de esta prueba)
  origen: 'CDMX', destino: 'Monterrey',
  modo: 'por_viaje', precio: 12000, moneda: 'MXN',
  vigenteDesde: '2026-08-01', vigenteHasta: null, activa: true,
};

beforeEach(() => { insertado = null; actualizado = null; eqUpdate.length = 0; });

describe('PRU-9 (D6): filaTarifa NO invierte origen/destino al escribir', () => {
  it('crearTarifa inserta origen y destino en la columna que les corresponde', async () => {
    await crearTarifa('t-1', TARIFA);
    expect(insertado).toMatchObject({ origen: 'CDMX', destino: 'Monterrey', tenant_id: 't-1' });
  });

  it('editarTarifa actualiza origen y destino sin invertirlos', async () => {
    await editarTarifa('t-1', '11111111-2222-3333-4444-555555555555', TARIFA);
    expect(actualizado).toMatchObject({ origen: 'CDMX', destino: 'Monterrey' });
  });
});
