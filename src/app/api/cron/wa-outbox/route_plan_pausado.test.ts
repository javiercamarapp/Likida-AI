import { describe, it, expect, vi, beforeEach } from 'vitest';

// F20: el outbox NO drena hacia operadores de una flota con plan pausado/cancelado (ni si no se puede leer el plan), y no llama a Meta.
vi.unmock('@/lib/saas/salidas_flota');

vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async () => 'encendido' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/admin/salud', () => ({
  registrarLatido: async () => {},
  puertaCron: async () => null,
}));
vi.mock('@/lib/meta/client', async (importar) => ({
  ...(await importar<typeof import('@/lib/meta/client')>()),
  sondearTokenWhatsApp: async () => ({ estado: 'ok' }),
}));
const finalizar = vi.fn(async () => ({ ok: true, muerta: false }));
vi.mock('@/lib/likida/wa_outbox', () => ({
  reconciliarReceiptsWhatsApp: async () => 0,
  purgarReceiptsWhatsApp: async () => 0,
  vencerSalidasWhatsApp: async () => [],
  reclamarSalidasWhatsApp: async () => [
    { id: 'out-flota', payload: { messaging_product: 'whatsapp', to: '5215512345678', text: { body: 'x' } } },
    { id: 'out-otro', payload: { messaging_product: 'whatsapp', to: '5215500000000', text: { body: 'y' } } },
  ],
  finalizarSalidaWhatsApp: (...a: unknown[]) => (finalizar as unknown as (...x: unknown[]) => unknown)(...a),
}));
vi.mock('@/lib/likida/lotes', () => ({
  conPool: async <T,>(xs: T[], _n: number, f: (x: T) => Promise<void>) => { for (const x of xs) await f(x); },
}));
vi.mock('@/lib/likida/presupuesto', async (i) => ({ ...(await i<typeof import('@/lib/likida/presupuesto')>()), acotada: (q: unknown) => q }));

type R = { data: unknown; error: { message: string } | null };
let plan: R = { data: [{ estado: 'pausada' }], error: null };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      let esDeLaFlota = false;
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.in = (_c: string, v: string[]) => { esDeLaFlota = v.some((x) => x.endsWith('5512345678')); return b; };
      const r = (): R => (t === 'suscripcion' ? plan
        : { data: t === 'operador' && esDeLaFlota ? [{ tenant_id: 't1' }] : [], error: null });
      b.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(r()).then(res, rej);
      return b;
    },
  }),
}));

const { GET } = await import('./route');
const { olvidarCacheSalidas } = await import('@/lib/saas/salidas_flota');
const REQ = () => new Request('https://likida.ai/api/cron/wa-outbox', { headers: { authorization: 'Bearer x' } });

describe('cron wa-outbox con el plan de la flota', () => {
  beforeEach(() => {
    olvidarCacheSalidas();
    vi.clearAllMocks();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] }), { status: 200 })));
  });

  it('plan pausado: la salida al operador de la flota se entierra como terminal SIN llamar a Meta; la de un número ajeno sale', async () => {
    plan = { data: [{ estado: 'pausada' }], error: null };
    const res = await GET(REQ());
    const j = await res.json();
    expect(j.frenadas).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).to).toBe('5215500000000');
    const c = finalizar.mock.calls as unknown as Array<[{ id: string }, string | undefined, string | undefined]>;
    expect(String(c.find((x) => x[0].id === 'out-flota')?.[2])).toBe('terminal:plan_pausada');
  });

  it('plan cancelado: igual', async () => {
    plan = { data: [{ estado: 'cancelada' }], error: null };
    await GET(REQ());
    const c = finalizar.mock.calls as unknown as Array<[{ id: string }, string | undefined, string | undefined]>;
    expect(String(c.find((x) => x[0].id === 'out-flota')?.[2])).toBe('terminal:plan_cancelada');
  });

  it('plan ilegible: NO sale y la fila vuelve a la cola (retryable), no se entierra', async () => {
    plan = { data: null, error: { message: 'caída' } };
    await GET(REQ());
    const c = finalizar.mock.calls as unknown as Array<[{ id: string }, string | undefined, string | undefined]>;
    expect(String(c.find((x) => x[0].id === 'out-flota')?.[2])).toBe('retryable:plan_ilegible');
    const destinos = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((x) => JSON.parse(String((x[1] as RequestInit).body)).to);
    expect(destinos).not.toContain('5215512345678');
  });

  it('plan activa: ambas salen', async () => {
    plan = { data: [{ estado: 'activa' }], error: null };
    const j = await (await GET(REQ())).json();
    expect(j.frenadas).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
