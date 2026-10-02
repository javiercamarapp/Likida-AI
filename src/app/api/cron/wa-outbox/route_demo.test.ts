import { describe, it, expect, vi, beforeEach } from 'vitest';

// El tenant demo nunca escribe a nadie: una salida del outbox con la marca de teléfono demo (28999…) muere en el cron
// SIN llamar a Meta, aunque alguien la haya encolado por otro camino. Una salida normal sigue saliendo.

let interruptor: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
vi.mock('@/lib/likida/interruptores', () => ({
  leerInterruptor: async () => interruptor,
}));

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));

const registrarLatido = vi.fn(async () => {});
vi.mock('@/lib/admin/salud', () => ({
  registrarLatido: (...a: unknown[]) => registrarLatido(...(a as [])),
  puertaCron: async (_c: string, req: Request) =>
    req.headers.get('authorization') === 'Bearer secreto-de-prueba'
      ? null
      : new Response(null, { status: 401 }),
}));


/** El sondeo del token (auditoría ola 1, #27) se controla desde la prueba; por omisión sirve. */
const sondeoToken = vi.hoisted(() => ({ estado: { estado: 'ok' } as Record<string, unknown> }));
vi.mock('@/lib/meta/client', async (importar) => ({
  ...(await importar<typeof import('@/lib/meta/client')>()),
  sondearTokenWhatsApp: async () => sondeoToken.estado,
}));

const reclamarSalidasWhatsApp = vi.fn(async () => [
  { id: 'out-demo', payload: { messaging_product: 'whatsapp', to: '28999900000001', text: { body: 'hola demo' } } },
  { id: 'out-real', payload: { messaging_product: 'whatsapp', to: '5215512345678', text: { body: 'Tu liquidación está lista' } } },
]);
const reconciliarReceiptsWhatsApp = vi.fn(async () => 0);
const purgarReceiptsWhatsApp = vi.fn(async () => 0);
const finalizarSalidaWhatsApp = vi.fn(async () => ({ ok: true, muerta: false }));
vi.mock('@/lib/likida/wa_outbox', () => ({
  reconciliarReceiptsWhatsApp: () => reconciliarReceiptsWhatsApp(),
  purgarReceiptsWhatsApp: () => purgarReceiptsWhatsApp(),
  reclamarSalidasWhatsApp: (...a: unknown[]) => reclamarSalidasWhatsApp(...(a as [])),
  finalizarSalidaWhatsApp: (...a: unknown[]) => finalizarSalidaWhatsApp(...(a as [])),
}));


vi.mock('@/lib/likida/lotes', () => ({
  conPool: async <T,>(xs: T[], _n: number, f: (x: T) => Promise<void>) => { for (const x of xs) await f(x); },
}));

import { GET } from './route';

const CON_SECRETO = { headers: { authorization: 'Bearer secreto-de-prueba' } };


describe('cron wa-outbox — destinatarios del tenant demo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sondeoToken.estado = { estado: 'ok' };
    interruptor = 'encendido';
    process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.PRUEBA' }] }), { status: 200 })));
  });

  it('la salida con teléfono demo NO llega a Meta y se finaliza como terminal; la real sí sale', async () => {
    const res = await GET(new Request('https://likida.ai/api/cron/wa-outbox', CON_SECRETO));
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).to).toBe('5215512345678');
    const demo = finalizarSalidaWhatsApp.mock.calls.find((c) => (c[0] as { id: string }).id === 'out-demo') as unknown[];
    expect(demo).toBeTruthy();
    expect(String(demo[2])).toMatch(/^terminal:.*demo/i);
  });
});
