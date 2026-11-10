import { beforeEach, describe, expect, it, vi } from 'vitest';

// La lista de suscripciones vivas de todas las flotas (panel de planes de /admin): mapea sin inventar, ordena con desempate y una base
// caída LANZA — nunca «ninguna suscripción», que es justo la frase que haría creer que nadie debería estar pagando.
let respuesta: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const llamadas: Array<[string, ...unknown[]]> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'order', 'limit']) b[m] = (...a: unknown[]) => { llamadas.push([m, ...a]); return b; };
    b.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respuesta).then(res, rej);
    return { from: () => b };
  },
}));
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-11-10' }));
const { listarSuscripcionesVivas } = await import('./suscripcion');

beforeEach(() => { llamadas.length = 0; });

describe('listarSuscripcionesVivas', () => {
  it('lee solo los cuatro estados vivos, con desempate, y mapea el plan y si ya venció', async () => {
    respuesta = { data: [
      { id: 's1', tenant_id: 't1', plan_clave: 'flota', estado: 'prueba', inicio: '2026-10-01', periodo_fin: '2026-10-31', stripe_customer_id: null, stripe_subscription_id: null, plan: { nombre: 'Flota' } },
      { id: 's2', tenant_id: 't2', plan_clave: 'empresa', estado: 'activa', inicio: '2026-10-01', periodo_fin: null, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', plan: [{ nombre: 'Empresa' }] },
    ], error: null };
    const r = await listarSuscripcionesVivas();
    expect(llamadas).toContainEqual(['in', 'estado', ['prueba', 'activa', 'morosa', 'pausada']]);
    expect(llamadas.filter((c) => c[0] === 'order').map((c) => c[1])).toEqual(['tenant_id', 'id']);
    expect(r[0]).toMatchObject({ tenantId: 't1', planNombre: 'Flota', vencida: true, stripeSubscriptionId: null });
    expect(r[1]).toMatchObject({ planNombre: 'Empresa', vencida: false, stripeSubscriptionId: 'sub_1' });
  });

  it('una base caída LANZA', async () => {
    respuesta = { data: null, error: { message: 'caída' } };
    await expect(listarSuscripcionesVivas()).rejects.toThrow(/caída/);
  });
});
