import { describe, it, expect, vi } from 'vitest';

// A39-S36-01: PostgREST recorta a `max_rows = 1000` en silencio. La lectura de emergencias abiertas (la lista que frena el envío al chofer) pedía
// `.limit(2000)` y se quedaba con 1000. Aquí el fake aplica ese recorte igual que el servidor: a `range` y a `limit`.
const MAX_ROWS = 1000;
let filasBase: Array<Record<string, unknown>> = [];

function consulta() {
  let desde = 0;
  let hasta = Number.POSITIVE_INFINITY;
  const q: Record<string, unknown> = {};
  const resolver = () => ({ data: filasBase.slice(desde, Math.min(hasta + 1, desde + MAX_ROWS)), error: null });
  Object.assign(q, {
    select: () => q, in: () => q, neq: () => q, gte: () => q, or: () => q, order: () => q,
    range: (d: number, h: number) => { desde = d; hasta = h; return q; },
    limit: (n: number) => { hasta = desde + n - 1; return q; },
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(resolver).then(res, rej),
  });
  return q;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => consulta() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: <T,>(q: T) => q }));

const { leerEmergenciasAbiertas } = await import('./trabajo');

const T = 'tenant-1';
const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ tenant_id: T, operador_id: `op-${i}`, viaje_id: null, unidad_id: null }));

describe('leerEmergenciasAbiertas pagina más allá de max_rows', () => {
  it('1,500 emergencias abiertas: las ve TODAS (antes se quedaba con 1,000)', async () => {
    filasBase = filas(1500);
    const m = await leerEmergenciasAbiertas([T]);
    expect(m.get(T)!.operadorIds.size).toBe(1500);
    expect(m.get(T)!.operadorIds.has('op-1499')).toBe(true);
  });

  it('más del tope: lanza (fail-closed) en vez de recortar en silencio', async () => {
    filasBase = filas(2001);
    await expect(leerEmergenciasAbiertas([T])).rejects.toThrow(/emergencias_abiertas/);
  });
});
