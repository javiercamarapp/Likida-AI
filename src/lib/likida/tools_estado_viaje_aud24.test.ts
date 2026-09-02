import { describe, it, expect, vi } from 'vitest';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, TC-1 (ALTO, reincidente 3ª ronda) — `estado_viaje` sumaba las
// copias que el motor excluye: dos "comprobado" del mismo viaje.
//
// El dataset es el del ensayo real que el motor documenta (engine.ts): el
// ticket de Costco de $7,881.05 TRES veces (dos fotos + reenvío) y un diésel
// de $1,800; anticipo $12,000. `cuadrar_viaje` decía $9,681.05 y
// `estado_viaje` $25,443.15 con "4 comprobantes". Aquí se fija que las dos
// cifras son LA MISMA —calculada con el mismo predicado exportado del motor—
// y que el desglose y los litros siguen la misma regla.
//
// Se mockea la CAPA DE DATOS (`supabaseAdmin`), nunca el handler: `executeTool`
// corre el handler REGISTRADO, como en `tools_camino_real.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const filasGasto = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null }));
const filaViaje = vi.hoisted(() => ({
  data: { origen: 'Mérida', destino: 'Cancún', anticipo: 12_000, estatus: 'abierto' } as Record<string, unknown> | null,
  error: null as { message: string } | null,
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./interruptores', () => ({ estaApagado: vi.fn(async () => false) }));
vi.mock('./agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn() }));
vi.mock('./config', () => ({ getConfig: vi.fn(async () => ({ politica: [] })) }));
vi.mock('./repo', () => ({ getAcumuladoCombustible: vi.fn(async () => ({ efectivo: 0, totalCombustible: 0 })) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b,
        maybeSingle: async () => filaViaje,
        order: async () => (tabla === 'gasto' ? filasGasto : { data: [], error: null }),
      });
      return b;
    },
  }),
}));

await import('./tools');
const { executeTool } = await import('@/lib/llm/tool-executor');
const { cuadrarViaje, copiasDeComprobante } = await import('./cuadre/engine');

const CTX = { tenantId: 't-1', viajeId: 'v-1', runId: '00000000-0000-4000-8000-0000000000e1' };

/** Tres fotos del MISMO ticket de Costco (mismo concepto+folio+monto) y un diésel. */
const COSTCO = { concepto: 'alimentacion', monto: 7881.05, folio: '059286188', folio_norm: '59286188' };
const DATASET: Array<Record<string, unknown>> = [
  { id: 'g-1', ...COSTCO, cfdi_uuid: null, cfdi_orden: null, ocr_extra: null },
  { id: 'g-2', concepto: 'diesel', monto: 1800, folio: '7318052', folio_norm: '7318052', cfdi_uuid: null, cfdi_orden: null, ocr_extra: { litros: 75 } },
  { id: 'g-3', ...COSTCO, folio: '59286188', cfdi_uuid: null, cfdi_orden: null, ocr_extra: null },   // la lectura sin el cero
  { id: 'g-4', ...COSTCO, cfdi_uuid: null, cfdi_orden: null, ocr_extra: null },                       // el reenvío
];

/** La forma que el motor lee — la misma que `repo.ts` arma desde la fila. */
function comoGasto(f: Record<string, unknown>): Gasto {
  return {
    id: String(f.id), concepto: f.concepto as Gasto['concepto'], monto: Number(f.monto),
    folio: (f.folio as string) || undefined, folioNorm: (f.folio_norm as string) || undefined,
    cfdiUuid: (f.cfdi_uuid as string) || undefined,
    ocrExtra: (f.ocr_extra as Record<string, unknown>) ?? undefined,
  };
}

async function estado() {
  const r = await executeTool('estado_viaje', {}, CTX);
  expect(r.error, r.error).toBeUndefined();
  return r.result as {
    comprobado: number; comprobantes: number; copias_excluidas: number;
    por_concepto: Array<{ concepto: string; total: number; n: number }>;
    litros_diesel_leidos: number | null;
  };
}

describe('estado_viaje — la misma regla de cubetas que el motor (TC-1)', () => {
  it('tres Costco + un diésel: comprobado $9,681.05, 2 comprobantes, 2 copias excluidas', async () => {
    filasGasto.data = DATASET;
    const r = await estado();
    expect(r.comprobado).toBeCloseTo(9_681.05, 2);
    expect(r.comprobantes).toBe(2);
    expect(r.copias_excluidas).toBe(2);
    expect(r.por_concepto).toEqual([
      { concepto: 'alimentacion', total: 7881.05, n: 1 },
      { concepto: 'diesel', total: 1800, n: 1 },
    ]);
  });

  it('es EL MISMO número que cuadrar_viaje sobre el mismo dataset', async () => {
    filasGasto.data = DATASET;
    const r = await estado();
    const gastos = DATASET.map(comoGasto);
    const liq = cuadrarViaje({ viajeId: 'v-1', anticipo: 12_000, gastos, politica: [] });
    expect(r.comprobado).toBeCloseTo(liq.totalComprobado, 6);
    // Y las copias que excluye son exactamente las que el predicado del motor marca.
    expect(r.copias_excluidas).toBe(copiasDeComprobante(gastos).size);
  });

  it('los litros se cuentan UNA vez aunque el diésel venga en dos fotos, y un monto en cero no suma', async () => {
    filasGasto.data = [
      { id: 'd-1', concepto: 'diesel', monto: 1800, folio: '7318052', folio_norm: '7318052', cfdi_uuid: null, cfdi_orden: null, ocr_extra: { litros: 75 } },
      { id: 'd-2', concepto: 'diesel', monto: 1800, folio: '7318052', folio_norm: '7318052', cfdi_uuid: null, cfdi_orden: null, ocr_extra: { litros: 75 } },
      { id: 'z-1', concepto: 'caseta', monto: 0, folio: null, folio_norm: null, cfdi_uuid: null, cfdi_orden: null, ocr_extra: null },
    ];
    const r = await estado();
    expect(r.comprobado).toBe(1800);
    expect(r.comprobantes).toBe(1);
    expect(r.copias_excluidas).toBe(1);
    expect(r.litros_diesel_leidos).toBe(75);
  });

  it('dos gastos AMPARADOS por el mismo CFDI con orden distinto (consolidada de CAPUFE) NO son copias', async () => {
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    filasGasto.data = [
      { id: 'c-1', concepto: 'caseta', monto: 250, folio: null, folio_norm: null, cfdi_uuid: uuid, cfdi_orden: 1, ocr_extra: null },
      { id: 'c-2', concepto: 'caseta', monto: 250, folio: null, folio_norm: null, cfdi_uuid: uuid, cfdi_orden: 2, ocr_extra: null },
    ];
    const r = await estado();
    expect(r.comprobado).toBe(500);
    expect(r.comprobantes).toBe(2);
    expect(r.copias_excluidas).toBe(0);
  });

  it('una lectura caída NO se convierte en cero gastos', async () => {
    filasGasto.data = [];
    filasGasto.error = { message: 'connection refused' };
    const r = await executeTool('estado_viaje', {}, CTX);
    expect(r.error).toMatch(/estado_viaje\/gastos/);
    filasGasto.error = null;
  });
});
