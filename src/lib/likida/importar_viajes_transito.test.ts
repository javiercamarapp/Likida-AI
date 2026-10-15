import { describe, it, expect, vi } from 'vitest';
import type { FilaViajeImportada } from './importar_viajes';

// T-A5-20: el importador escribe el estado de tránsito normalizado (0804) solo cuando el archivo lo declara.
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

describe('importarViajes — estado de tránsito en el lote', () => {
  it('escribe transito_estado, texto de origen y marca solo en las filas que lo declaran', async () => {
    const r = await importarViajes('t1', [
      fila('TR-0001', { transito: { estado: 'en_patio', textoOrigen: 'PATIO NLD' } }),
      fila('TR-0002'),
    ]);
    expect(r.creados).toBe(2);
    const [con, sin] = lotes[0];
    expect(con.transito_estado).toBe('en_patio');
    expect(con.transito_texto_origen).toBe('PATIO NLD');
    expect(typeof con.transito_actualizado_en).toBe('string');
    for (const k of ['transito_estado', 'transito_texto_origen', 'transito_actualizado_en']) expect(sin).not.toHaveProperty(k);
  });
});
