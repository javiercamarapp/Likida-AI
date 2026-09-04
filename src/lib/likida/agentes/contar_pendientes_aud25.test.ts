// ═══════════════════════════════════════════════════════════════════════════
// AUD25 · rendimiento MEDIO línea 312 (REND-A5) — `contarPendientesPorAgente`
// leía `agente_insumo` con `.limit(5000)`, que PostgREST recorta en silencio
// a 1,000 (`pg.ts:38-48`). Su propio comentario decía que un recorte futuro
// se delataría por un conteo que deja de crecer — ya estaba recortado desde
// siempre, así que ese aviso nunca podía dispararse.
//
// Esta prueba simula el recorte de PostgREST de verdad sobre 1,200 insumos
// pendientes y comprueba que el conteo total es 1,200, no 1,000.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';

const MAX_ROWS_POSTGREST = 1_000;
const TOTAL_INSUMOS = 1_200;

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const insumos = Array.from({ length: TOTAL_INSUMOS }, (_, i) => ({
  id: `insumo-${String(i).padStart(5, '0')}`,
  agente: 'control_costos',
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'agente_insumo') throw new Error(`tabla inesperada en la prueba: ${tabla}`);
      let pedirConteo = false;
      let desde = 0;
      let hasta = insumos.length - 1;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, o?: { count?: string }) => { pedirConteo = o?.count === 'exact'; return b; },
        is: () => b,
        order: () => b,
        range: (d: number, h: number) => { desde = d; hasta = h; return b; },
        limit: (n: number) => { desde = 0; hasta = Math.min(n, insumos.length) - 1; return b; },
        then: (res: (v: unknown) => unknown) => {
          const ventana = insumos.slice(desde, Math.min(hasta, desde + MAX_ROWS_POSTGREST - 1) + 1);
          return Promise.resolve({ data: ventana, error: null, count: pedirConteo ? insumos.length : undefined }).then(res);
        },
      });
      return b;
    },
  }),
}));

const { contarPendientesPorAgente } = await import('./insumos');

describe('AUD25 rendimiento MEDIO L312: contarPendientesPorAgente no se queda en las primeras 1,000', () => {
  it('con 1,200 insumos pendientes, el conteo total es 1,200', async () => {
    const m = await contarPendientesPorAgente();
    expect(m.get('control_costos')).toBe(TOTAL_INSUMOS);
  });
});
