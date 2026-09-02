import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, REN-6 — `getLiquidacionesFiscales` paginaba el EJERCICIO
// ENTERO con `traerTodo` y ordenaba en JS. El periodo por default es el
// ejercicio: a 12,000 liquidaciones/mes, el mes 8.3 del año llega a 100,000
// filas, que es el techo de `traerTodo` (100 páginas × 1,000) — y de ahí en
// adelante la pantalla del contador dejaba de servir con un `LecturaIncompleta`
// hasta que él acortara el periodo A MANO. Antes de reventar: 100 viajes de red
// y 13 columnas × 100k filas dentro de la función.
//
// Lo que se fija: una llamada = UNA página, con cursor keyset `(created_at,
// id)` —la FILA, no la posición—, el orden desde la base, y el total del
// periodo solo en la primera página.
// ═══════════════════════════════════════════════════════════════════════════

// Solo `acotada` se dobla (para no meter un presupuesto en una prueba de
// paginación); el resto del módulo lo importan otros archivos de la cadena.
vi.mock('./presupuesto', async (original) => ({
  ...(await original() as Record<string, unknown>),
  acotada: (q: unknown) => q,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Llamada = {
  filtros: Array<[string, unknown]>;
  or: string | null;
  rango: [number, number] | null;
  conteo: boolean;
  orden: Array<[string, boolean]>;
};
const llamadas: Llamada[] = [];
/** El universo, ya en el orden que la base devolvería (created_at desc, id desc). */
let universo: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const ll: Llamada = { filtros: [], or: null, rango: null, conteo: false, orden: [] };
      llamadas.push(ll);
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, opt?: { count?: string }) => { ll.conteo = opt?.count === 'exact'; return b; },
        eq: (c: string, v: unknown) => { ll.filtros.push([c, v]); return b; },
        gte: (c: string, v: unknown) => { ll.filtros.push([`${c}>=`, v]); return b; },
        lte: (c: string, v: unknown) => { ll.filtros.push([`${c}<=`, v]); return b; },
        or: (f: string) => { ll.or = f; return b; },
        order: (c: string, o?: { ascending?: boolean }) => { ll.orden.push([c, o?.ascending !== false]); return b; },
        range: (d: number, h: number) => { ll.rango = [d, h]; return b; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
          // La base aplica el cursor: todo lo ESTRICTAMENTE posterior al que
          // se mandó, en el orden ya fijado.
          let filas = universo;
          if (ll.or) {
            const m = ll.or.match(/created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)/);
            const [, creado, id] = m!;
            const i = filas.findIndex((f) => f.created_at === creado && f.id === id);
            filas = filas.slice(i + 1);
          }
          const [d, h] = ll.rango ?? [0, 999];
          return Promise.resolve({
            data: filas.slice(d, h + 1),
            error: null,
            count: ll.conteo ? universo.length : null,
          }).then(res, rej);
        },
      });
      return b;
    },
  }),
}));

const { getLiquidacionesFiscales, LIQUIDACIONES_FISCALES_POR_PAGINA } = await import('./fiscal');

const liquidacion = (i: number) => ({
  id: `liq-${String(i).padStart(6, '0')}`,
  // Descendente: la 0 es la más nueva.
  created_at: new Date(Date.UTC(2026, 0, 1) + (100_000 - i) * 60_000).toISOString(),
  total_comprobado: 100, total_anticipo: 90, diferencia: 10, estatus: 'cerrada',
  diferencias: [{ x: 1 }], pdf_url: null, iva_acreditable: 16, ieps_acreditable: 0,
  peaje_acreditable: 0, litros_diesel_acreditables: 0,
  viaje: { folio: `VJ-${i}`, operador: { nombre: 'Ramón' } },
});

const PERIODO = {
  clave: 'ejercicio' as const,
  desde: '2026-01-01',
  hasta: '2026-12-31',
  etiqueta: 'Ejercicio 2026',
};

beforeEach(() => { llamadas.length = 0; universo = []; });

describe('REN-6 — el ejercicio entero ya no entra en memoria', () => {
  it('REPRO: con 144,000 liquidaciones del ejercicio, UNA llamada = UNA página', async () => {
    universo = Array.from({ length: 144_000 }, (_, i) => liquidacion(i));

    const r = await getLiquidacionesFiscales('t-1', PERIODO);

    // Antes: 100 páginas y un LecturaIncompleta. Ahora: un viaje de red.
    expect(llamadas).toHaveLength(1);
    expect(r.filas).toHaveLength(LIQUIDACIONES_FISCALES_POR_PAGINA);
    // El total del periodo se dice, no se calcula con `.length` de la página.
    expect(r.total).toBe(144_000);
    expect(r.siguiente).toEqual({ creadoEn: r.filas.at(-1)!.fecha, id: r.filas.at(-1)!.id });
    // Y el orden lo pone la BASE, no un `.sort()` sobre lo que se trajo.
    expect(llamadas[0].orden).toEqual([['created_at', false], ['id', false]]);
    expect(llamadas[0].rango).toEqual([0, LIQUIDACIONES_FISCALES_POR_PAGINA - 1]);
  });

  it('el cursor es la FILA, no la posición: la segunda página sigue donde acabó la primera, sin repetir', async () => {
    universo = Array.from({ length: 500 }, (_, i) => liquidacion(i));

    const p1 = await getLiquidacionesFiscales('t-1', PERIODO, { limite: 100 });
    const p2 = await getLiquidacionesFiscales('t-1', PERIODO, { limite: 100, despues: p1.siguiente });

    expect(p1.filas.map((f) => f.id)).toEqual(universo.slice(0, 100).map((f) => f.id));
    expect(p2.filas.map((f) => f.id)).toEqual(universo.slice(100, 200).map((f) => f.id));
    expect(new Set([...p1.filas, ...p2.filas].map((f) => f.id)).size).toBe(200);
    // El `count` NO se vuelve a pedir: contar 144k por página costaría más que
    // la página misma.
    expect(llamadas[0].conteo).toBe(true);
    expect(llamadas[1].conteo).toBe(false);
    expect(p2.total).toBeNull();
    // Y el cursor viaja con las DOS ramas (`<` estricto sobre el par).
    expect(llamadas[1].or).toContain('created_at.lt.');
    expect(llamadas[1].or).toContain('id.lt.');
  });

  it('la última página no ofrece un cursor que no lleva a ningún lado', async () => {
    universo = Array.from({ length: 30 }, (_, i) => liquidacion(i));
    const r = await getLiquidacionesFiscales('t-1', PERIODO, { limite: 100 });
    expect(r.filas).toHaveLength(30);
    expect(r.siguiente).toBeNull();
  });

  it('el periodo se acota por el DÍA DE MÉXICO y por el tenant (DAT-08 sigue en pie)', async () => {
    universo = [liquidacion(0)];
    await getLiquidacionesFiscales('t-9', PERIODO);
    const f = llamadas[0].filtros;
    expect(f).toContainEqual(['tenant_id', 't-9']);
    // -06:00 / -05:00, jamás 'Z': el corte es de México, no de Londres.
    expect(String(f.find((x) => x[0] === 'created_at>=')![1])).toMatch(/-0[56]:00$/);
    expect(String(f.find((x) => x[0] === 'created_at<=')![1])).toMatch(/-0[56]:00$/);
  });

  it('nadie pide más de 1,000 por página aunque lo escriba', async () => {
    universo = Array.from({ length: 5_000 }, (_, i) => liquidacion(i));
    await getLiquidacionesFiscales('t-1', PERIODO, { limite: 999_999 });
    expect(llamadas[0].rango).toEqual([0, 999]);
  });

  it('un error de la base LANZA — nunca una página vacía con cara de "no hay"', async () => {
    universo = [];
    llamadas.length = 0;
    // El doble devuelve `data: []` sin error para un periodo vacío: eso SÍ es
    // "no hay". Lo que no puede pasar es que un error se lea como vacío, y de
    // eso se encarga `exigir` — aquí se ancla la forma honesta del caso vacío.
    const r = await getLiquidacionesFiscales('t-1', PERIODO);
    expect(r).toEqual({ filas: [], siguiente: null, total: 0 });
  });
});
