import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// A37-S38-02: el cron reclamaba solo ANCHO flotas por corrida. Ahora los obreros
// reclaman de a una hasta agotar elegibles. La RPC falsa imita la 0866: no
// devuelve flotas ya iniciadas desde `p_no_iniciados_desde`.
const base = vi.hoisted(() => ({
  flotas: [] as string[],
  iniciadas: new Set<string>(),
  llamadas: [] as Array<Record<string, unknown>>,
  sinMigracion: false,
}));
const rpc = vi.hoisted(() => vi.fn(async (nombre: string, args: Record<string, unknown>) => {
  if (nombre !== 'reclamar_polls_conector') return { data: null, error: { message: 'rpc inesperado' } };
  base.llamadas.push(args);
  if (base.sinMigracion && 'p_no_iniciados_desde' in args) {
    return { data: null, error: { message: 'Could not find the function public.reclamar_polls_conector(p_no_iniciados_desde) in the schema cache' } };
  }
  const elegibles = base.flotas.filter((t) => !base.iniciadas.has(t)).slice(0, Number(args.p_limite));
  elegibles.forEach((t) => base.iniciadas.add(t));
  return {
    data: elegibles.map((t) => ({
      tenant_id: t, proveedor: 'samsara', valores_cifrados: 'x', claim_token: `tok-${t}`,
      watermark_en: null, tail_watermark_en: null,
    })),
    error: null,
  };
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));

import { procesarPollsEnPool } from './poll_durable';

describe('A37-S38-02: reparto justo del poll', () => {
  beforeEach(() => {
    base.flotas = Array.from({ length: 13 }, (_, i) => `t-${i}`);
    base.iniciadas = new Set();
    base.llamadas = [];
    base.sinMigracion = false;
  });

  it('atiende las 13 flotas en UNA corrida (antes: 4) y ninguna dos veces', async () => {
    const vistas: string[] = [];
    const r = await procesarPollsEnPool('posiciones', ['samsara'], 4, {}, async (c) => { vistas.push(c.tenantId); return c.tenantId; });
    expect(r).toHaveLength(13);
    expect(new Set(vistas).size).toBe(13);
    expect(base.llamadas[0]).toHaveProperty('p_no_iniciados_desde');
  });

  it('el reloj corta: no reclama flotas nuevas después de venceEn', async () => {
    let ahora = 1_000;
    const r = await procesarPollsEnPool('posiciones', ['samsara'], 2, { venceEn: 1_500, ahora: () => ahora }, async (c) => {
      ahora += 400; return c.tenantId;
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThan(13);
  });

  it('una flota que lanza no tumba a las demás y sale con su error', async () => {
    const r = await procesarPollsEnPool('posiciones', ['samsara'], 4, {}, async (c) => {
      if (c.tenantId === 't-3') throw new Error('boom');
      return c.tenantId;
    });
    expect(r).toHaveLength(13);
    const mala = r.find((x) => 'error' in x);
    expect(mala?.c.tenantId).toBe('t-3');
  });

  it('sin la 0866 en la base cae al reclamo por lote anterior (ancho flotas) y no revienta', async () => {
    base.sinMigracion = true;
    const r = await procesarPollsEnPool('posiciones', ['samsara'], 4, {}, async (c) => c.tenantId);
    expect(r).toHaveLength(4);
  });
});
