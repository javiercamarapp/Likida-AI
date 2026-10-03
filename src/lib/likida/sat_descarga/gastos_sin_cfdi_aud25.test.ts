// ═══════════════════════════════════════════════════════════════════════════
// AUD25 · rendimiento MEDIO línea 312 (REND-A5) — `gastosSinCfdi` leía `gasto`
// con `.limit(5000)`, que PostgREST recorta en silencio a 1,000 (`pg.ts:38-48`).
// Con una flota de 100 unidades y ~2,000 gastos sin comprobante en el mes,
// `decidirCruce` solo veía la mitad del fondo: los CFDI cuyo ticket cayó
// fuera del corte se marcaban `disponible` en vez de `casado`.
//
// Esta prueba simula el recorte de PostgREST de verdad —cada página nunca
// entrega más de max_rows, sin importar lo que se pida— sobre 1,800 gastos
// sin CFDI y comprueba que `gastosSinCfdi` los trae TODOS.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';

const MAX_ROWS_POSTGREST = 1_000;
const TOTAL_GASTOS = 1_800;

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const gastos = Array.from({ length: TOTAL_GASTOS }, (_, i) => ({
  id: `gasto-${String(i).padStart(5, '0')}`,
  concepto: 'diesel',
  monto: 100,
  fecha: '2026-08-10',
  rfc_emisor: null,
  cfdi_uuid: null,
  ocr_extra: null,
}));

/** Cada llamada de `.range(desde, …)` con `desde > 0`: un OFFSET. El arreglo de la ronda 16 no debe usar ninguno. */
const offsets: number[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'gasto') throw new Error(`tabla inesperada en la prueba: ${tabla}`);
      let pedirConteo = false;
      let cursor: { fecha: string; id: string } | null = null;
      let tope = gastos.length;
      let rango: [number, number] | null = null;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, o?: { count?: string }) => { pedirConteo = o?.count === 'exact'; return b; },
        eq: () => b,
        is: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        // Cursor por fila `(fecha, id)`: lo que `traerTodoPorLlave` pide con `.or('fecha.gt.F,and(fecha.eq.F,id.gt.I)')`.
        or: (expr: string) => {
          const m = /^fecha\.gt\.([\d-]+),and\(fecha\.eq\.\1,id\.gt\.(.+)\)$/.exec(expr);
          if (!m) throw new Error(`filtro or inesperado: ${expr}`);
          cursor = { fecha: m[1], id: m[2] };
          return b;
        },
        limit: (n: number) => { tope = n; return b; },
        // El código VIEJO paginaba por posición: cualquier `range` con inicio > 0 es un offset.
        range: (d: number, h: number) => { if (d > 0) offsets.push(d); rango = [d, h]; return b; },
        then: (res: (v: unknown) => unknown) => {
          const c = cursor as { fecha: string; id: string } | null;
          const base = c === null ? gastos : gastos.filter((g) => g.fecha > c.fecha || (g.fecha === c.fecha && g.id > c.id));
          // El servidor NUNCA entrega más de max_rows, pida lo que pida.
          const ventana = rango
            ? gastos.slice(rango[0], Math.min(rango[1], rango[0] + MAX_ROWS_POSTGREST - 1) + 1)
            : base.slice(0, Math.min(tope, MAX_ROWS_POSTGREST));
          return Promise.resolve({ data: ventana, error: null, count: pedirConteo ? gastos.length : undefined }).then(res);
        },
      });
      return b;
    },
  }),
}));

const { gastosSinCfdi } = await import('./ciclo');

describe('AUD25 rendimiento MEDIO L312: gastosSinCfdi trae el fondo COMPLETO, no solo las primeras 1,000', () => {
  it('con 1,800 gastos sin CFDI en el rango, los 1,800 vuelven', async () => {
    const r = await gastosSinCfdi('t1', '2026-08-01', '2026-08-31');
    expect(r).toHaveLength(TOTAL_GASTOS);
    expect(new Set(r.map((g) => g.id)).size).toBe(TOTAL_GASTOS);
  });

  // RONDA 16 (carga de 250 camiones): con 10-23k tickets sin CFDI en el rango, la
  // lectura por OFFSET costaba O(n²) en el servidor (2 ms en la posición 0, 250 ms
  // en la 99,000) y corría las posiciones si entraba un gasto a media lectura.
  it('pagina por CURSOR (fecha, id): ninguna página se pide con offset', async () => {
    offsets.length = 0;
    await gastosSinCfdi('t1', '2026-08-01', '2026-08-31');
    expect(offsets, 'ningún range(desde>0): el costo de cada página no puede crecer con la posición').toEqual([]);
  });
});
