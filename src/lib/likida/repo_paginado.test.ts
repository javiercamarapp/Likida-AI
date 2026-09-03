import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ARQUITECTURA 25 (BAJO, REINCIDENTE) — `repo_paginado.ts` declara en su
// encabezado que «NINGUNA de estas funciones LANZA por un fallo de lectura …
// el fallo se atrapa aquí y viaja en `error`». `buscarViajesVivos` (el combo
// «Adjuntar a…» de Huérfanos) rompe el contrato dos veces:
//   · SÍ lanza si la primera consulta (por folio) falla — eso ya lo hacía;
//   · y cuando la SEGUNDA consulta (por nombre de operador) falla, el error
//     se descarta EN SILENCIO (`if (!errOp && porOperador)`) y la función
//     devuelve la lista corta de la primera consulta como si fuera completa.
//     Un timeout del pooler en la segunda vuelta se lee como «no hay
//     resultados» en vez de «no se pudo completar la búsqueda».
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Resultado = { data: unknown; error: { message: string } | null };

/** Cola de resultados: cada llamada a `.limit()` (donde la consulta se
 *  cierra en este archivo) consume el siguiente resultado de la cola. */
let cola: Resultado[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        in: () => b,
        ilike: () => b,
        order: () => b,
        limit: () => Promise.resolve(cola.shift() ?? { data: [], error: null }),
      });
      return b;
    },
  }),
}));

const { buscarViajesVivos } = await import('./repo_paginado');

describe('ARQ-25 · buscarViajesVivos no puede quedarse callado sobre un fallo', () => {
  it('si la SEGUNDA consulta (por operador) falla, la función LANZA — no devuelve la primera mitad como si fuera todo', async () => {
    cola = [
      { data: [{ id: 'v-1', folio: 'F-1', origen: 'GDL', destino: 'MTY', operador: { nombre: 'Pérez' } }], error: null }, // por folio: 1 fila
      { data: null, error: { message: 'timeout del pooler' } }, // por operador: FALLA
    ];
    await expect(buscarViajesVivos('t-1', 'Ramírez')).rejects.toThrow('timeout del pooler');
  });

  it('si las dos consultas van bien, junta folio + operador sin duplicar', async () => {
    cola = [
      { data: [{ id: 'v-1', folio: 'F-1', origen: 'GDL', destino: 'MTY', operador: { nombre: 'Pérez' } }], error: null },
      { data: [{ id: 'v-2', folio: 'F-2', origen: 'CDMX', destino: 'QRO', operador: { nombre: 'Ramírez' } }], error: null },
    ];
    const r = await buscarViajesVivos('t-1', 'Ramírez');
    expect(r.map((x) => x.id)).toEqual(['v-1', 'v-2']);
  });

  it('sin texto de búsqueda, solo pide una vez (no hay segunda vuelta por operador)', async () => {
    cola = [{ data: [{ id: 'v-1', folio: 'F-1', origen: null, destino: null, operador: null }], error: null }];
    const r = await buscarViajesVivos('t-1', '');
    expect(r).toHaveLength(1);
    expect(cola).toHaveLength(0); // no le sobró un resultado sin consumir
  });
});
