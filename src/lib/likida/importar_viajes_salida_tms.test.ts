import { describe, it, expect, vi } from 'vitest';
import type { FilaViajeImportada } from './importar_viajes';

// T-A5-22: el importador lee la «Fecha Salida» con hora del TMS (candidato a hito) y la escribe en viaje.tms_salida_en (0804).
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

const { importarViajes, interpretarFilasViajes, archivoTraeCitas } = await import('./importar_viajes');

const ZONA = 'America/Mexico_City';
const fila = (folio: string, extra: Partial<FilaViajeImportada> = {}): FilaViajeImportada => ({
  folio, origen: 'ORIGEN SINTETICO', destino: 'DESTINO SINTETICO', fechaInicio: '2026-10-13', anticipo: null,
  operadorNombre: `OPERADOR ${folio}`, unidadEco: null, clienteNombre: null, ingresoFlete: null, kmRecorridos: null, ...extra,
});

describe('interpretarFilasViajes — «Fecha Salida» del TMS', () => {
  it('la celda con hora y segundos es la marca del TMS (hora de la flota → UTC) y la fecha del viaje sigue siendo el día', () => {
    const r = interpretarFilasViajes([['Viaje', 'Fecha Salida'], ['9000001', '2026-10-13 10:22:07']], { zona: ZONA });
    expect(r.viajes[0].tmsSalidaEn).toBe('2026-10-13T16:22:07.000Z');
    expect(r.viajes[0].fechaInicio).toBe('2026-10-13');
    expect(r.descartadas).toEqual([]);
  });

  it('la fecha SOLA no es una marca (no se inventa una hora): la fila entra con su fecha de siempre y sin marca', () => {
    const r = interpretarFilasViajes([['Viaje', 'Fecha Salida'], ['9000001', '13/10/2026']], { zona: ZONA });
    expect(r.viajes[0].fechaInicio).toBe('2026-10-13');
    expect(r.viajes[0]).not.toHaveProperty('tmsSalidaEn');
  });

  it('una hora ilegible no tumba la fila (conserva su fecha); vacía tampoco', () => {
    const r = interpretarFilasViajes([['Viaje', 'Fecha Salida'], ['9000001', '2026-10-13 25:99:00'], ['9000002', '']], { zona: ZONA });
    expect(r.viajes).toHaveLength(2);
    expect(r.descartadas).toEqual([]);
    for (const v of r.viajes) expect(v).not.toHaveProperty('tmsSalidaEn');
  });

  it('sin la columna, el archivo se lee igual que siempre', () => {
    const r = interpretarFilasViajes([['Viaje', 'Origen'], ['9000001', 'X']], { zona: ZONA });
    expect(r.viajes[0]).not.toHaveProperty('tmsSalidaEn');
  });

  it('el encabezado «salida tms» trae la marca sin tocar la fecha del viaje', () => {
    const r = interpretarFilasViajes([['Viaje', 'Salida TMS'], ['9000001', '13/10/2026 10:22']], { zona: ZONA });
    expect(r.viajes[0].tmsSalidaEn).toBe('2026-10-13T16:22:00.000Z');
    expect(r.viajes[0].fechaInicio).toBeNull();
  });

  it('un archivo con esa columna pide conocer la zona de la flota (como las citas)', () => {
    expect(archivoTraeCitas([['Viaje', 'Fecha Salida']])).toBe(true);
    expect(archivoTraeCitas([['Viaje', 'Origen']])).toBe(false);
  });
});

describe('importarViajes — la marca del TMS en el lote', () => {
  it('escribe tms_salida_en solo en las filas que la traen (la clave ausente no toca la columna)', async () => {
    const r = await importarViajes('t1', [fila('TS-0001', { tmsSalidaEn: '2026-10-13T16:22:07.000Z' }), fila('TS-0002')]);
    expect(r.creados).toBe(2);
    const [con, sin] = lotes[lotes.length - 1];
    expect(con.tms_salida_en).toBe('2026-10-13T16:22:07.000Z');
    expect(sin).not.toHaveProperty('tms_salida_en');
  });
});
