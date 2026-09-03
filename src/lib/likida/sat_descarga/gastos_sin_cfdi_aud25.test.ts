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

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'gasto') throw new Error(`tabla inesperada en la prueba: ${tabla}`);
      let pedirConteo = false;
      let desde = 0;
      let hasta = gastos.length - 1;
      let usaLimit = false;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, o?: { count?: string }) => { pedirConteo = o?.count === 'exact'; return b; },
        eq: () => b,
        is: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        range: (d: number, h: number) => { usaLimit = false; desde = d; hasta = h; return b; },
        // El código VIEJO (pre-arreglo) usaba `.limit(n)` sin paginar.
        limit: (n: number) => { usaLimit = true; desde = 0; hasta = Math.min(n, gastos.length) - 1; return b; },
        then: (res: (v: unknown) => unknown) => {
          void usaLimit;
          const ventana = gastos.slice(desde, Math.min(hasta, desde + MAX_ROWS_POSTGREST - 1) + 1);
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
  });
});
