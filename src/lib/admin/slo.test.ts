import { beforeEach, describe, expect, it, vi } from 'vitest';

// FE-8: los dos SLO de corridas salen de `slo_agente_corrida()` (mig. 0162),
// ya contados por la base. Antes se leía `agente_corrida` con `.limit(5000)` y
// SIN `order` —las 1,000 filas arbitrarias a las que PostgREST recorta— y se
// calculaba el p95 en JS sobre esa muestra que nadie eligió. El mock responde
// por nombre de RPC: alimentar filas crudas describiría una lectura muerta.
const porTabla = new Map<string, { data?: unknown[] | Record<string, unknown> | null; count?: number | null; error: { message: string } | null }>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string) => {
      const r = porTabla.get(fn) ?? { error: { message: 'no mockeada' } };
      return { then: (res: (v: unknown) => unknown) => Promise.resolve({ data: r.data ?? null, error: r.error }).then(res) };
    },
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
    porTabla.set('slo_agente_corrida', {
      data: { total: 10, ok: 9, medibles: 9, p95Segundos: 30 }, error: null,
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
    porTabla.set('slo_agente_corrida', { data: { total: 1, ok: 1, medibles: 1, p95Segundos: 4 }, error: null });
    const slos = await getSLOs();
    for (const s of slos) expect(s.cumple).toBeNull();
    expect(slos.find((s) => s.clave === 'wa_inbox')?.medido).toBe('no se pudo leer');
  });

  it('p95 en NULL no es un error de forma: es "no hay corridas medibles", y se dice', async () => {
    porTabla.set('slo_agente_corrida', { data: { total: 40, ok: 40, medibles: 0, p95Segundos: null }, error: null });
    const slos = await getSLOs();
    const por = new Map(slos.map((s) => [s.clave, s]));
    expect(por.get('agentes_exito')?.cumple).toBe(true);
    expect(por.get('agentes_p95')?.cumple).toBeNull();
    expect(por.get('agentes_p95')?.medido).toMatch(/muestra insuficiente/);
  });

  it('la 0162 sin aplicar deja los dos SLO en "no se pudo leer", nunca en verde', async () => {
    porTabla.set('slo_agente_corrida', { data: null, error: null });
    const slos = await getSLOs();
    const por = new Map(slos.map((s) => [s.clave, s]));
    expect(por.get('agentes_exito')?.medido).toBe('no se pudo leer');
    expect(por.get('agentes_p95')?.medido).toBe('no se pudo leer');
  });
});
