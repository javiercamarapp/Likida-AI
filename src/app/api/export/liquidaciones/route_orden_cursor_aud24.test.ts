// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-4 — el export de liquidaciones pagina por cursor keyset
// `(created_at, id) < (última)`, y ese cursor solo significa "el resto de la
// tabla" si Postgres devuelve las filas en el MISMO orden que el cursor
// asume. La mutación M4 (`route.ts:116-117`) quita los dos `.order()` antes
// de `.range()` y la suite completa —incluido `rutas_export.test.ts`, cuyo
// doble genérico acepta `order()` sin mirar sus argumentos— sigue en verde.
//
// Esta prueba usa un doble PROPIO que SÍ registra cada llamada en orden y
// exige que, antes del primer `.range()`, la cadena haya pedido
// `order(created_at, desc)` y `order(id, desc)` — en ese orden, que es el que
// hace que el cursor `.or('created_at.lt....')` de una página posterior
// recorte exactamente el sufijo correcto.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/tenant-api', () => ({
  resolverTenantApi: async () => ({ ok: true as const, tenantId: 't-1', rol: 'flota_admin' }),
}));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

/** Cada método de la cadena, en el orden en que se llamó. */
const llamadas: string[] = [];

function builder() {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    // AUD24 (integración): BLOQ-6 (revision) añadió el filtro de firma
    // humana sobre esta misma consulta (`neq`/`in` según `rev.filtro`,
    // FILTRO_REVISION_DEFECTO='firmadas' por omisión) — el doble necesita
    // los dos métodos aunque esta prueba no verifique el filtro en sí.
    neq: () => b,
    in: () => b,
    gte: () => b,
    lt: () => b,
    or: () => b,
    order: (col: string, opt?: { ascending?: boolean }) => {
      llamadas.push(`order:${col}:${opt?.ascending === false ? 'desc' : 'asc'}`);
      return b;
    },
    range: (d: number, h: number) => {
      llamadas.push(`range:${d}:${h}`);
      return b;
    },
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));

const { GET } = await import('./route');

beforeEach(() => { llamadas.length = 0; });

describe('PRU-4: la página del cursor pide ORDER BY (created_at, id) desc ANTES de range', () => {
  it('range(0, 999) va precedido, en la misma cadena, de los dos order() del cursor', async () => {
    const r = await GET(new Request('https://app.likida.ai/api/export/liquidaciones?desde=2026-06-01&hasta=2026-08-31'));
    expect(r.status).toBe(200);

    const iRange = llamadas.indexOf('range:0:999');
    expect(iRange).toBeGreaterThan(-1);
    // Sin ORDER BY, PostgREST puede devolver las filas en cualquier orden y el
    // cursor `(created_at, id) < (última)` deja de significar "el resto de la
    // tabla": liquidaciones repetidas o ausentes en el CSV.
    expect(llamadas.slice(0, iRange)).toEqual(['order:created_at:desc', 'order:id:desc']);
  });
});
