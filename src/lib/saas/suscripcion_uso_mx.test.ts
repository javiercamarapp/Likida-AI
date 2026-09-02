import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H24 — "Viajes creados este mes" se cortaba en UTC.
//
// `getUso` armaba el primer día del mes con `Date.UTC(...)`: entre las 18:00
// y la medianoche de México, el 1° del mes en México AÚN es el mes anterior
// en UTC (o viceversa cerca del cambio de año), así que "este mes" incluía o
// excluía un día entero de viajes según la hora del día en que se abriera el
// panel. El corte tiene que anclarse al día de México (`hoyMx`/`inicioDiaMx`),
// como el resto del producto (ver DAT-08 en `formato.ts`).
// ═══════════════════════════════════════════════════════════════════════════

const gteCapturado: Record<string, string> = {};

function tabla(nombre: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    gte: (_col: string, val: string) => { gteCapturado[nombre] = val; return api; },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tabla(t) }) }));

const { getUso } = await import('./suscripcion');

describe('getUso — corte de "este mes" en día de México', () => {
  it('a las 23:50 UTC del último día del mes (17:50 en México, mes vigente) usa el 1° del mes en México', async () => {
    // 2026-02-28T23:50:00Z → en México (UTC-6) sigue siendo 2026-02-28
    // 17:50, así que "este mes" es febrero: el corte debe ser 2026-02-01,
    // NO 2026-02-01 en UTC ni saltarse a marzo por el reloj de Londres.
    const hoy = new Date('2026-02-28T23:50:00Z');
    await getUso('t1', null, hoy);
    expect(gteCapturado.viaje).toBe('2026-02-01T00:00:00-06:00');
  });

  it('a las 04:00 UTC del día 1 (22:00 del último día del mes anterior en México) el corte sigue siendo el mes anterior', async () => {
    // 2026-03-01T04:00:00Z → en México (UTC-6) es 2026-02-28 22:00: en
    // México TODAVÍA es febrero, aunque en UTC ya sea marzo.
    const hoy = new Date('2026-03-01T04:00:00Z');
    await getUso('t1', null, hoy);
    expect(gteCapturado.viaje).toBe('2026-02-01T00:00:00-06:00');
  });
});
