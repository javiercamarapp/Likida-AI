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

// Cada nombre amarra a un id determinista; devolver `null` simula al no
// encontrado (los tests de sin-operador lo fuerzan por caso).
const resolver = vi.fn(async (_tenant: string, nombre: string): Promise<{ operadorId: string } | null> =>
  ({ operadorId: `op-${nombre}` }));
vi.mock('./crear_viaje_wa', () => ({
  resolverOperadorPorNombre: (...a: unknown[]) => resolver(...(a as [string, string])),
  OperadorNombreAmbiguo: class OperadorNombreAmbiguo extends Error {},
}));
vi.mock('./conv', () => ({ ConsultaFallida: class ConsultaFallida extends Error {} }));

type FilaInsert = { folio: string; operador_id: string | null };

/** Lo que la lectura previa de folios "ve" — cada import consume una página.
 *  Dejarla vacía simula la carrera: la lectura corre ANTES del insert ajeno. */
let paginasLectura: Array<Array<{ folio: string }>>;
/** La "base": folios ya insertados, con el unique 0092 impuesto. */
let enBase: Set<string>;
let llamadasUpsert: number;
/** Los lotes tal como llegaron al upsert — para afirmar qué NO llegó. */
let lotesUpsert: FilaInsert[][];
/** La respuesta de la consulta de operadores ocupados (0029) — una página
 *  por llamada; vacía = nadie trae viaje abierto. */
let ocupadosResp: Array<Array<{ operador_id: string }>>;
let ocupadosError: { message: string } | null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => {
        const nodo: Record<string, unknown> = {};
        for (const m of ['eq', 'not', 'in', 'order', 'abortSignal']) nodo[m] = () => nodo;
        nodo.range = () => Promise.resolve({ data: paginasLectura.shift() ?? [], error: null });
        // La consulta de OCUPADOS (0029) no pagina: se espera el builder
        // directo — el thenable resuelve con su página.
        nodo.then = (res: (v: unknown) => unknown) =>
          Promise.resolve(ocupadosError
            ? { data: null, error: ocupadosError }
            : { data: ocupadosResp.shift() ?? [], error: null }).then(res);
        return nodo;
      },
      // El camino NUEVO: ON CONFLICT DO NOTHING contra viaje_folio_unico —
      // devuelve SOLO las filas que de verdad entraron. Y COMO LA BASE REAL,
      // rechaza el lote entero si una fila trae operador_id NULL (la columna
      // es NOT NULL desde la 0001) — el fake que no lo imponía es exactamente
      // lo que dejó pasar el lateral de AUD3.
      upsert: (lote: FilaInsert[]) => ({
        select: () => {
          llamadasUpsert++;
          lotesUpsert.push(lote);
          if (lote.some((f) => f.operador_id == null)) {
            return Promise.resolve({
              data: null,
              error: { code: '23502', message: 'null value in column "operador_id" of relation "viaje" violates not-null constraint' },
            });
          }
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

// Cada folio trae SU operador (distinto): desde el lateral AUD3 una fila sin
// operador amarrado ya no se inserta (operador_id es NOT NULL), y dos filas
// del mismo operador chocan con el 0029 — los describes de abajo fijan ambos.
const fila = (folio: string): FilaViajeImportada => ({
  folio, origen: null, destino: null, fechaInicio: '2026-08-01', anticipo: 8000,
  operadorNombre: `Chofer ${folio}`,
});

beforeEach(() => {
  paginasLectura = [];
  enBase = new Set();
  llamadasUpsert = 0;
  lotesUpsert = [];
  ocupadosResp = [];
  ocupadosError = null;
  resolver.mockClear();
  logger.error.mockClear();
});

describe('importarViajes — el dedup aguanta la carrera porque vive en la base', () => {
  it('REPRO BE-A3: dos submits concurrentes del mismo archivo — el perdedor NO duplica y su acuse dice creados: 0', async () => {
    // Las dos lecturas de `existentes` ven la base VACÍA (la carrera exacta:
    // ambas corren antes del insert de la otra).
    const archivo = [fila('V-100'), fila('V-101')];

    const a = await importarViajes('t1', archivo);
    expect(a).toEqual({ creados: 2, saltados: [], operadoresSinAmarrar: [], sinOperador: [], operadorOcupado: [] });

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

describe('los candados de la base, respetados ANTES del insert (laterales AUD3)', () => {
  it('la fila sin operador amarrado NO va al insert — el resto del lote sí entra', async () => {
    resolver.mockImplementation(async (_t: string, nombre: string) =>
      nombre === 'Fantasma' ? null : { operadorId: `op-${nombre}` });
    const r = await importarViajes('t1', [
      { ...fila('V-1') },
      { ...fila('V-2'), operadorNombre: 'Fantasma' },
      { ...fila('V-3'), operadorNombre: null },
    ]);
    // Antes: las tres filas iban al upsert, la NULL tumbaba el LOTE ENTERO
    // (23502) y "revisa y vuelve a subir" repetía el mismo choque para
    // siempre. Ahora la V-1 entra y las otras dos se dicen con su folio.
    expect(r.error).toBeUndefined();
    expect(r.creados).toBe(1);
    expect(r.sinOperador.sort()).toEqual(['V-2', 'V-3']);
    expect(r.operadoresSinAmarrar).toEqual(['Fantasma']);
    expect(lotesUpsert.flat().map((f) => f.folio)).toEqual(['V-1']);
  });

  it('el operador que YA trae viaje abierto en la base se salta con su folio (0029)', async () => {
    ocupadosResp = [[{ operador_id: 'op-Chofer V-1' }]];
    const r = await importarViajes('t1', [fila('V-1'), fila('V-2')]);
    expect(r.creados).toBe(1);
    expect(r.operadorOcupado).toEqual(['V-1']);
    expect(lotesUpsert.flat().map((f) => f.folio)).toEqual(['V-2']);
  });

  it('dos filas del MISMO operador en el archivo: la primera gana, la segunda se dice', async () => {
    const r = await importarViajes('t1', [
      fila('V-1'),
      { ...fila('V-2'), operadorNombre: 'Chofer V-1' },
    ]);
    expect(r.creados).toBe(1);
    expect(r.operadorOcupado).toEqual(['V-2']);
  });

  it('si la lectura de ocupados falla, NO se importa nada y se dice — jamás insertar a ciegas', async () => {
    ocupadosError = { message: 'timeout' };
    const r = await importarViajes('t1', [fila('V-1')]);
    expect(r.creados).toBe(0);
    expect(r.error).toMatch(/no importé nada/i);
    expect(llamadasUpsert).toBe(0);
  });
});
