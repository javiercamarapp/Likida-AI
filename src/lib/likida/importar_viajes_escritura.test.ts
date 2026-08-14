import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FilaViajeImportada } from './importar_viajes';

// ═══════════════════════════════════════════════════════════════════════════
// LA MITAD QUE ESCRIBE — `importarViajes` contra Supabase mockeado (auditoría
// 3, BE-A3). El fake impone lo mismo que la base real desde 0092: el unique
// `viaje_folio_unico (tenant_id, folio)`. El hallazgo: el dedup vivía SOLO en
// el read-then-insert del código — dos submits concurrentes leían `existentes`
// antes de que el otro insertara y los 200 viajes entraban dos veces, con las
// dos respuestas diciendo "creados: 200".
// ═══════════════════════════════════════════════════════════════════════════

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

vi.mock('./crear_viaje_wa', () => ({
  resolverOperadorPorNombre: vi.fn(async () => null),
  OperadorNombreAmbiguo: class OperadorNombreAmbiguo extends Error {},
}));
vi.mock('./conv', () => ({ ConsultaFallida: class ConsultaFallida extends Error {} }));

type FilaInsert = { folio: string };

/** Lo que la lectura previa de folios "ve" — cada import consume una página.
 *  Dejarla vacía simula la carrera: la lectura corre ANTES del insert ajeno. */
let paginasLectura: Array<Array<{ folio: string }>>;
/** La "base": folios ya insertados, con el unique 0092 impuesto. */
let enBase: Set<string>;
let llamadasUpsert: number;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => {
        const nodo: Record<string, unknown> = {};
        for (const m of ['eq', 'not', 'order']) nodo[m] = () => nodo;
        nodo.range = () => Promise.resolve({ data: paginasLectura.shift() ?? [], error: null });
        return nodo;
      },
      // El camino NUEVO: ON CONFLICT DO NOTHING contra viaje_folio_unico —
      // devuelve SOLO las filas que de verdad entraron.
      upsert: (lote: FilaInsert[]) => ({
        select: () => {
          llamadasUpsert++;
          const insertadas = lote.filter((f) => !enBase.has(f.folio));
          insertadas.forEach((f) => enBase.add(f.folio));
          return Promise.resolve({ data: insertadas.map((f) => ({ folio: f.folio })), error: null });
        },
      }),
      // El camino VIEJO (insert plano): contra el unique, el lote entero
      // truena con 23505 — así fallaba el código anterior a BE-A3.
      insert: (lote: FilaInsert[]) => ({
        select: () => {
          const dup = lote.find((f) => enBase.has(f.folio));
          if (dup) {
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: `duplicate key value violates unique constraint "viaje_folio_unico" (${dup.folio})` },
            });
          }
          lote.forEach((f) => enBase.add(f.folio));
          return Promise.resolve({ data: lote.map((f) => ({ id: `id-${f.folio}` })), error: null });
        },
      }),
    }),
  }),
}));

const { importarViajes } = await import('./importar_viajes');

const fila = (folio: string): FilaViajeImportada => ({
  folio, origen: null, destino: null, fechaInicio: '2026-08-01', anticipo: 8000, operadorNombre: null,
});

beforeEach(() => {
  paginasLectura = [];
  enBase = new Set();
  llamadasUpsert = 0;
  logger.error.mockClear();
});

describe('importarViajes — el dedup aguanta la carrera porque vive en la base', () => {
  it('REPRO BE-A3: dos submits concurrentes del mismo archivo — el perdedor NO duplica y su acuse dice creados: 0', async () => {
    // Las dos lecturas de `existentes` ven la base VACÍA (la carrera exacta:
    // ambas corren antes del insert de la otra).
    const archivo = [fila('V-100'), fila('V-101')];

    const a = await importarViajes('t1', archivo);
    expect(a).toEqual({ creados: 2, saltados: [], operadoresSinAmarrar: [] });

    // El segundo submit leyó ANTES del insert del primero (lectura vacía) —
    // sin el candado de la base, aquí salían 4 viajes y otro "creados: 2".
    const b = await importarViajes('t1', archivo);
    expect(b.creados).toBe(0);
    expect(b.saltados.sort()).toEqual(['V-100', 'V-101']);
    expect(b.error).toBeUndefined();

    expect(enBase.size).toBe(2);
  });

  it('el mismo archivo dos veces EN SERIE: la lectura previa los salta con nombre, sin tocar el insert', async () => {
    const archivo = [fila('V-100'), fila('V-101')];
    await importarViajes('t1', archivo);

    // Ahora la lectura SÍ ve lo insertado (sin carrera).
    paginasLectura = [[{ folio: 'V-100' }, { folio: 'V-101' }]];
    const upsertsAntes = llamadasUpsert;
    const r = await importarViajes('t1', archivo);
    expect(r.creados).toBe(0);
    expect(r.saltados.sort()).toEqual(['V-100', 'V-101']);
    expect(llamadasUpsert).toBe(upsertsAntes); // no hubo nada que insertar
  });

  it('carrera parcial: entra lo nuevo, lo que chocó se reporta como saltado — creados cuenta SOLO lo que entró', async () => {
    enBase = new Set(['V-100']); // otro submit lo metió después de nuestra lectura
    const r = await importarViajes('t1', [fila('V-100'), fila('V-200')]);
    expect(r.creados).toBe(1);
    expect(r.saltados).toEqual(['V-100']);
  });
});
