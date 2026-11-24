import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const correo = { asunto: 'Desglose', avance: 'a', titulo: 't', parrafos: ['p'], porQueLoRecibes: 'Lo recibes por ser operador.' };
const LOGO = { base64: 'QUJD', contentType: 'image/png', nombre: 'cliente.png' };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 'llave-de-prueba');
  vi.stubEnv('RESEND_EMAIL_DOMAIN', 'mail.likida.ai');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function enviar(op: Record<string, unknown>) {
  const f = vi.fn(async (_u: string, _i: RequestInit) => { void _u; void _i; return new Response(JSON.stringify({ id: 'c1' }), { status: 200 }); });
  vi.stubGlobal('fetch', f);
  const { enviarCorreo } = await import('./enviar');
  await enviarCorreo('op@flota.mx', correo, op); // grep-limpio:ok
  return JSON.parse(f.mock.calls[0][1].body as string);
}

describe('enviarCorreo corporativo', () => {
  it('adjunta los dos logos en línea (Likida y flota) antes de los adjuntos del llamador', async () => {
    const body = await enviar({ corporativo: { logoCliente: LOGO, nombreCliente: 'Flota Prueba SA' }, adjuntos: [{ filename: 'd.xlsx', content: 'QQ==' }] });
    expect(body.attachments).toHaveLength(3);
    expect(body.attachments[0]).toMatchObject({ content_id: 'likida-logo', content_disposition: 'inline' });
    expect(body.attachments[1]).toMatchObject({ content_id: 'cliente-logo', content_disposition: 'inline', content_type: 'image/png', content: 'QUJD' });
    expect(body.attachments[2]).toEqual({ filename: 'd.xlsx', content: 'QQ==' });
    expect(body.html).toContain('cid:cliente-logo');
    expect(body.text).toContain('Flota Prueba SA');
  });

  it('sin logo de la flota: solo el de Likida', async () => {
    const body = await enviar({ corporativo: {}, adjuntos: [{ filename: 'd.xlsx', content: 'QQ==' }] });
    expect(body.attachments.map((a: { content_id?: string }) => a.content_id)).toEqual(['likida-logo', undefined]);
    expect(body.html).not.toContain('cid:cliente-logo');
  });

  it('es operativo: nunca lleva List-Unsubscribe, aunque venga listaBajaUrl', async () => {
    const body = await enviar({ corporativo: { logoCliente: LOGO }, listaBajaUrl: 'https://app.likida.ai/baja/x' });
    expect(body.headers).toBeUndefined();
  });

  it('manda sobre sobrio', async () => {
    const body = await enviar({ corporativo: { logoCliente: LOGO }, sobrio: true });
    expect(body.html).toContain('cid:likida-logo');
  });

  it('sin corporativo nada cambia: el defecto sigue con su logo y su pie', async () => {
    const body = await enviar({});
    expect(body.attachments).toHaveLength(1);
    expect(body.html).not.toContain('cid:cliente-logo');
  });
});
