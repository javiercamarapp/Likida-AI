import { describe, it, expect, vi } from 'vitest';
import type { FilaViajeImportada } from './importar_viajes';

// T-A5-13: el importador de viajes lee la columna opcional de despacho (Icident) y la guarda en `viaje.despacho_ref`.
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

const { importarViajes, interpretarFilasViajes } = await import('./importar_viajes');

const fila = (folio: string, extra: Partial<FilaViajeImportada> = {}): FilaViajeImportada => ({
  folio, origen: 'ORIGEN SINTETICO', destino: 'DESTINO SINTETICO', fechaInicio: '2026-10-06', anticipo: null,
  operadorNombre: `OPERADOR ${folio}`, unidadEco: null, clienteNombre: null, ingresoFlete: null, kmRecorridos: null, ...extra,
});

describe('interpretarFilasViajes — columna de despacho', () => {
  it('reconoce «Icident» (cualquier caja) y «Despacho», y normaliza; «viaje» sigue siendo el folio', () => {
    for (const enc of ['Icident', 'ICIDENT', 'Despacho', 'No. Despacho']) {
      const r = interpretarFilasViajes([['Folio', 'Origen', 'Destino', enc], ['V-1', 'A', 'B', ' d 77 ']]);
      expect(r.viajes[0].despachoRef).toBe('D77');
    }
    const solo = interpretarFilasViajes([['Viaje', 'Origen', 'Destino'], ['V-1', 'A', 'B']]);
    expect(solo.viajes[0].folio).toBe('V-1');
    expect(solo.viajes[0]).not.toHaveProperty('despachoRef');
  });
  it('celda vacía o sin columna → la llave no existe (el resultado es idéntico al de hoy)', () => {
    const r = interpretarFilasViajes([['Folio', 'Origen', 'Destino', 'Icident'], ['V-1', 'A', 'B', ''], ['V-2', 'A', 'B', 'x1']]);
    expect(r.viajes[0]).not.toHaveProperty('despachoRef');
    expect(r.viajes[1].despachoRef).toBe('X1');
    expect(r.descartadas).toEqual([]);
  });
});

describe('importarViajes — despacho_ref en el lote', () => {
  it('escribe despacho_ref solo en las filas que lo traen; el conteo creado no cambia', async () => {
    const r = await importarViajes('t1', [fila('DES-0001', { despachoRef: 'D77' }), fila('DES-0002')]);
    expect(r.creados).toBe(2);
    const [con, sin] = lotes[0];
    expect(con.despacho_ref).toBe('D77');
    expect(sin).not.toHaveProperty('despacho_ref');
  });
});
