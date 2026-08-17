import { beforeEach, describe, expect, it, vi } from 'vitest';

const porTabla = new Map<string, { data?: unknown[]; count?: number | null; error: { message: string } | null }>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const r = porTabla.get(tabla) ?? { error: { message: 'no mockeada' } };
      const fin = () => Promise.resolve({ data: r.data ?? null, count: r.count ?? null, error: r.error });
      const api: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'lt', 'is', 'eq']) api[m] = () => api;
      (api as { limit: unknown }).limit = fin;
      (api as { then: unknown }).then = (res: (v: unknown) => unknown) => fin().then(res);
      return api;
    },
  }),
}));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => 1_755_000_000_000 }));

const { getSLOs } = await import('./slo');

beforeEach(() => porTabla.clear());

describe('getSLOs — objetivos declarados contra datos reales', () => {
  it('con datos: mide, compara y NUNCA inventa un verde', async () => {
    const T0 = 1_754_999_000_000;
    porTabla.set('agente_corrida', {
      data: Array.from({ length: 10 }, (_, i) => ({
        estado: i < 9 ? 'ok' : 'fallo',
        inicio: new Date(T0).toISOString(),
        fin: new Date(T0 + 30_000).toISOString(),
      })), error: null,
    });
    porTabla.set('wa_evento_pendiente', { count: 0, error: null });
    porTabla.set('evento_stripe', { count: 2, error: null });
    porTabla.set('bus_orden', { count: 0, error: null });
    const slos = await getSLOs();
    const por = new Map(slos.map((s) => [s.clave, s]));
    expect(por.get('agentes_exito')?.cumple).toBe(false);   // 90% < 95%
    expect(por.get('agentes_p95')?.cumple).toBe(true);      // 30s ≤ 120s
    expect(por.get('wa_inbox')?.cumple).toBe(true);
    expect(por.get('stripe_sellado')?.cumple).toBe(false);  // 2 sin sellar
    expect(por.get('bus_ordenes')?.cumple).toBe(true);
  });

  it('sin muestra suficiente o sin lectura: cumple=null, jamás verde de cortesía', async () => {
    porTabla.set('agente_corrida', { data: [{ estado: 'ok', inicio: 'x', fin: 'x' }], error: null });
    const slos = await getSLOs();
    for (const s of slos) expect(s.cumple).toBeNull();
    expect(slos.find((s) => s.clave === 'wa_inbox')?.medido).toBe('no se pudo leer');
  });
});
