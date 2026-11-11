import { beforeEach, describe, expect, it, vi } from 'vitest';

// F20: la pausa (y la cancelación) frenan las salidas; morosa y «sin suscripción» (plan demo, el piloto) NO; ante cualquier duda, no sale.
vi.unmock('@/lib/saas/salidas_flota');

type R = { data: unknown; error: { message: string } | null };
let porTabla: Record<string, R> = {};
const consultas: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      consultas.push(t);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit']) b[m] = () => b;
      b.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(porTabla[t] ?? { data: [], error: null }).then(res, rej);
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', async (i) => ({ ...(await i<typeof import('@/lib/likida/presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  decidirSalidas, veredictoSalidasDeFlota, veredictoSalidasHaciaTelefono, salidasPermitidas, olvidarCacheSalidas,
  AVISO_PLAN_EN_PAUSA,
} = await import('./salidas_flota');

beforeEach(() => { porTabla = {}; consultas.length = 0; olvidarCacheSalidas(); });

describe('decidirSalidas (pura)', () => {
  it.each([
    [[], true, 'libre'],
    [['prueba'], true, 'prueba'],
    [['activa'], true, 'activa'],
    [['morosa'], true, 'morosa'],
    [['pausada'], false, 'pausada'],
    [['cancelada'], false, 'cancelada'],
    [['cancelada', 'activa'], true, 'activa'],
    [['cancelada', 'pausada'], false, 'pausada'],
    [['rarisima'], false, 'ilegible'],
  ] as const)('%j → salen=%s (%s)', (estados, salen, estado) => {
    const v = decidirSalidas(estados);
    expect(v.salen).toBe(salen);
    expect(v.estado).toBe(estado);
  });

  it('el mensaje de la pausa es el que ve el cliente', () => {
    const v = decidirSalidas(['pausada']);
    expect(v.salen === false && v.mensaje).toBe('Plan en pausa: los agentes no envían nada');
    expect(AVISO_PLAN_EN_PAUSA).toBe('Plan en pausa: los agentes no envían nada');
  });
});

describe('veredictoSalidasDeFlota (lee la base)', () => {
  it('pausada → no sale', async () => {
    porTabla.suscripcion = { data: [{ estado: 'pausada' }], error: null };
    expect(await salidasPermitidas('t1')).toBe(false);
  });
  it('sin suscripciones (plan demo / piloto) → SALE: no se frena a las flotas de hoy', async () => {
    porTabla.suscripcion = { data: [], error: null };
    expect(await salidasPermitidas('t1')).toBe(true);
  });
  it('base caída → NO sale (falla cerrado) y no queda en caché', async () => {
    porTabla.suscripcion = { data: null, error: { message: 'caída' } };
    const v = await veredictoSalidasDeFlota('t1');
    expect(v).toMatchObject({ salen: false, estado: 'ilegible' });
    porTabla.suscripcion = { data: [{ estado: 'activa' }], error: null };
    expect((await veredictoSalidasDeFlota('t1')).salen).toBe(true);
  });
  it('sin tenant → no sale', async () => {
    expect((await veredictoSalidasDeFlota(null)).salen).toBe(false);
  });
});

describe('veredictoSalidasHaciaTelefono', () => {
  it('teléfono de un operador de flota pausada → no sale', async () => {
    porTabla.operador = { data: [{ tenant_id: 't1' }], error: null };
    porTabla.suscripcion = { data: [{ estado: 'pausada' }], error: null };
    expect((await veredictoSalidasHaciaTelefono('5215512345678')).salen).toBe(false);
  });
  it('teléfono que no es de ninguna flota → sale', async () => {
    expect((await veredictoSalidasHaciaTelefono('5215500000000')).salen).toBe(true);
  });
  it('no se puede resolver el dueño → no sale', async () => {
    porTabla.operador = { data: null, error: { message: 'caída' } };
    expect(await veredictoSalidasHaciaTelefono('5215512345678')).toMatchObject({ salen: false, estado: 'ilegible' });
  });
  it('operador de flota activa → sale', async () => {
    porTabla.operador = { data: [{ tenant_id: 't1' }], error: null };
    porTabla.suscripcion = { data: [{ estado: 'activa' }], error: null };
    expect((await veredictoSalidasHaciaTelefono('5215512345678')).salen).toBe(true);
  });
});
