import { describe, it, expect, vi } from 'vitest';
import type { FilaViajeImportada } from './importar_viajes';

// T-A5-05: las citas llegan a las columnas `cita_origen_en` / `cita_destino_en` del lote, y solo cuando el archivo las trae.
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./crear_viaje_wa', () => ({
  elegirOperadorPorNombre: (_f: unknown, texto: string) => ({ operadorId: `op-${texto}` }),
  OperadorNombreAmbiguo: class OperadorNombreAmbiguo extends Error {},
}));

const lotes: Array<Array<Record<string, unknown>>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: (tabla: string) => {
      if (tabla === 'operador') {
        const nodo: Record<string, unknown> = {};
        for (const m of ['eq', 'not', 'in', 'order', 'abortSignal', 'select']) nodo[m] = () => nodo;
        nodo.range = () => Promise.resolve({ data: [], error: null });
        return nodo;
      }
      return {
        select: () => {
          const nodo: Record<string, unknown> = {};
          for (const m of ['eq', 'not', 'in', 'order', 'abortSignal']) nodo[m] = () => nodo;
          nodo.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
          return nodo;
        },
        upsert: (lote: Array<Record<string, unknown>>) => {
          lotes.push(lote);
          return { select: () => Promise.resolve({ data: lote.map((f, i) => ({ id: `v-${i}`, folio: f.folio })), error: null }) };
        },
      };
    },
  }),
}));

const { importarViajes } = await import('./importar_viajes');

const fila = (folio: string, extra: Partial<FilaViajeImportada> = {}): FilaViajeImportada => ({
  folio, origen: 'ORIGEN SINTETICO', destino: 'DESTINO SINTETICO', fechaInicio: '2026-10-06', anticipo: null,
  operadorNombre: `OPERADOR ${folio}`, unidadEco: null, clienteNombre: null, ingresoFlete: null, kmRecorridos: null, ...extra,
});

describe('importarViajes — citas en el lote', () => {
  it('escribe cita_origen_en / cita_destino_en solo en las filas que las traen', async () => {
    const r = await importarViajes('t1', [
      fila('SIN-0001', { citaOrigen: '2026-10-06T12:00:00.000Z', citaDestino: '2026-10-07T15:00:00.000Z' }),
      fila('SIN-0002'),
    ]);
    expect(r.creados).toBe(2);
    const [con, sin] = lotes[0];
    expect(con).toMatchObject({ cita_origen_en: '2026-10-06T12:00:00.000Z', cita_destino_en: '2026-10-07T15:00:00.000Z' });
    expect(sin).not.toHaveProperty('cita_origen_en');
    expect(sin).not.toHaveProperty('cita_destino_en');
  });
});
