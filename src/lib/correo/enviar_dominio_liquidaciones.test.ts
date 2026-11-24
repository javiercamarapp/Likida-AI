import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const correo = { asunto: 'Desglose', avance: 'a', titulo: 't', parrafos: ['p'], porQueLoRecibes: 'Lo recibes por ser operador.' };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 'llave-de-prueba');
  vi.stubEnv('RESEND_EMAIL_DOMAIN', 'mail.ejemplo.test');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function enviar(op: Record<string, unknown>) {
  const f = vi.fn(async (_u: string, _i: RequestInit) => { void _u; void _i; return new Response(JSON.stringify({ id: 'c1' }), { status: 200 }); });
  vi.stubGlobal('fetch', f);
  const { enviarCorreo } = await import('./enviar');
  await enviarCorreo('op@flota.test', correo, op); // grep-limpio:ok
  return JSON.parse(f.mock.calls[0][1].body as string);
}

describe('dominio de envío dedicado para desgloses', () => {
  it('sin la variable el remitente es idéntico al actual, aunque se pida el dominio', async () => {
    const base = await enviar({});
    const pedido = await enviar({ dominioEnvio: 'liquidaciones' });
    expect(base.from).toBe('Likida <avisos@mail.ejemplo.test>');
    expect(pedido.from).toBe(base.from);
  });

  it('con la variable y la opción, sale del dominio dedicado con parte local desgloses', async () => {
    vi.stubEnv('RESEND_EMAIL_DOMAIN_LIQUIDACIONES', 'pagos.ejemplo.test');
    const body = await enviar({ dominioEnvio: 'liquidaciones' });
    expect(body.from).toBe('Likida <desgloses@pagos.ejemplo.test>');
  });

  it('respeta remitenteLocal y remitenteNombre explícitos, y Reply-To', async () => {
    vi.stubEnv('RESEND_EMAIL_DOMAIN_LIQUIDACIONES', 'pagos.ejemplo.test');
    const body = await enviar({ dominioEnvio: 'liquidaciones', remitenteLocal: 'pagos', remitenteNombre: 'Flota', replyTo: 'resp@flota.test' });
    expect(body.from).toBe('Flota <pagos@pagos.ejemplo.test>');
    expect(body.reply_to).toBe('resp@flota.test');
  });

  it('otros flujos NO cambian aunque la variable exista', async () => {
    vi.stubEnv('RESEND_EMAIL_DOMAIN_LIQUIDACIONES', 'pagos.ejemplo.test');
    expect((await enviar({})).from).toBe('Likida <avisos@mail.ejemplo.test>');
    expect((await enviar({ remitenteLocal: 'acceso' })).from).toBe('Likida <acceso@mail.ejemplo.test>');
    expect((await enviar({ listaBajaUrl: 'https://app.ejemplo.test/baja/x' })).from).toBe('Likida <avisos@mail.ejemplo.test>');
  });

  it('el flujo de desglose no lleva List-Unsubscribe ni con corporativo ni con sobrio', async () => {
    vi.stubEnv('RESEND_EMAIL_DOMAIN_LIQUIDACIONES', 'pagos.ejemplo.test');
    const url = 'https://app.ejemplo.test/baja/x';
    expect((await enviar({ dominioEnvio: 'liquidaciones', corporativo: {}, listaBajaUrl: url })).headers).toBeUndefined();
    expect((await enviar({ dominioEnvio: 'liquidaciones', sobrio: true, listaBajaUrl: url })).headers).toBeUndefined();
  });

  it('variable vacía o en blanco equivale a no definida', async () => {
    vi.stubEnv('RESEND_EMAIL_DOMAIN_LIQUIDACIONES', '   ');
    expect((await enviar({ dominioEnvio: 'liquidaciones' })).from).toBe('Likida <avisos@mail.ejemplo.test>');
  });
});
