// ═══════════════════════════════════════════════════════════════════════════
// AUD25 · rendimiento MEDIO línea 312 (REND-A5) — `leerCostos` (ingenieria.ts)
// leía `agente_corrida` con `.limit(5000)`, que PostgREST recorta en silencio
// a `min(limit, max_rows)` = 1,000 (`pg.ts:38-48`). Con ~34 agentes
// habilitados × 6 pasadas/día (~1,428 filas/semana) el parte «Rendimiento»
// reportaba «costo por corrida» sobre una muestra arbitraria del 70%.
//
// Esta prueba simula el recorte de PostgREST de verdad —cada página nunca
// entrega más de `max_rows`, sin importar lo que se le pida— sobre una
// ventana de 1,500 filas y comprueba que `leerCostos` las trae TODAS
// (paginando), no solo las primeras 1,000.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';

const MAX_ROWS_POSTGREST = 1_000;
const TOTAL_FILAS = 1_500;

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const filas = Array.from({ length: TOTAL_FILAS }, (_, i) => ({
  id: `id-${String(i).padStart(5, '0')}`,
  agente: i % 2 === 0 ? 'liquidacion' : 'peaje',
  costo_usd: 0.01,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'agente_corrida') throw new Error(`tabla inesperada en la prueba: ${tabla}`);
      let pedirConteo = false;
      let desde = 0;
      let hasta = filas.length - 1;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, o?: { count?: string }) => { pedirConteo = o?.count === 'exact'; return b; },
        gte: () => b,
        order: () => b,
        range: (d: number, h: number) => { desde = d; hasta = h; return b; },
        // El código VIEJO (pre-arreglo) usaba `.limit(n)` sin paginar: se
        // simula igual que PostgREST — nunca entrega más de max_rows, sin
        // importar el `n` pedido, y siempre desde el principio.
        limit: (n: number) => { desde = 0; hasta = Math.min(n, filas.length) - 1; return b; },
        then: (res: (v: unknown) => unknown) => {
          // PostgREST de verdad: NUNCA entrega más de max_rows por página,
          // sin importar lo ancho que sea el `range` pedido.
          const ventana = filas.slice(desde, Math.min(hasta, desde + MAX_ROWS_POSTGREST - 1) + 1);
          return Promise.resolve({ data: ventana, error: null, count: pedirConteo ? filas.length : undefined }).then(res);
        },
      });
      return b;
    },
  }),
}));

const { leerCostos } = await import('./ingenieria');

describe('AUD25 rendimiento MEDIO L312: leerCostos trae TODAS las filas, no solo las primeras 1,000', () => {
  it('con 1,500 corridas en la ventana, las 1,500 se cuentan — ninguna PostgREST-truncation silenciosa', async () => {
    const costos = await leerCostos('2026-08-01T00:00:00Z');
    const totalCorridas = costos.reduce((s, c) => s + c.corridas, 0);
    expect(totalCorridas).toBe(TOTAL_FILAS);
    expect(costos.find((c) => c.agente === 'liquidacion')?.corridas).toBe(TOTAL_FILAS / 2);
    expect(costos.find((c) => c.agente === 'peaje')?.corridas).toBe(TOTAL_FILAS / 2);
  });
});
