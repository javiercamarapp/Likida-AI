import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const correo = { asunto: 'Desglose', avance: 'a', titulo: 't', parrafos: ['p'], porQueLoRecibes: 'Lo recibes por ser operador.' };

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
  const r = await enviarCorreo('op@flota.mx', correo, op); // grep-limpio:ok
  const init = f.mock.calls[0][1];
  return { r, body: JSON.parse(init.body as string) };
}

describe('enviarCorreo sobrio / remitente / replyTo (T-A1-12)', () => {
  it('defecto sin cambios: from Likida, logo, sin reply_to', async () => {
    const { body } = await enviar({});
    expect(body.from).toBe('Likida <avisos@mail.likida.ai>'); // grep-limpio:ok
    expect(body.attachments[0].content_disposition).toBe('inline');
    expect(body.reply_to).toBeUndefined();
  });
  it('remitenteNombre configurable y saneado', async () => {
    const { body } = await enviar({ remitenteNombre: 'Pagos Flota' });
    expect(body.from).toBe('Pagos Flota <avisos@mail.likida.ai>'); // grep-limpio:ok
  });
  it('nombre con <script> o salto de línea se sanea', async () => {
    const { body } = await enviar({ remitenteNombre: 'Pagos<script>alert(1)</script>\r\nBcc: x@y.com' }); // grep-limpio:ok
    expect(body.from).not.toMatch(/[\r\n]/);
    expect(body.from).not.toContain('<script');
    expect(body.from.match(/</g)).toHaveLength(1);
    expect(body.from.endsWith('<avisos@mail.likida.ai>')).toBe(true); // grep-limpio:ok
  });
  it('nombre vacío tras sanear usa Likida; se recorta a 60', async () => {
    expect((await enviar({ remitenteNombre: '<>\n' })).body.from).toBe('Likida <avisos@mail.likida.ai>'); // grep-limpio:ok
    const largo = (await enviar({ remitenteNombre: 'a'.repeat(100) })).body.from as string;
    expect(largo.split(' <')[0]).toHaveLength(60);
  });
  it('reply_to presente si es válido; ausente si no', async () => {
    expect((await enviar({ replyTo: 'rh@flota.mx' })).body.reply_to).toBe('rh@flota.mx'); // grep-limpio:ok
    expect((await enviar({ replyTo: 'no-es-correo' })).body.reply_to).toBeUndefined();
    expect((await enviar({ replyTo: 'a@b.mx\r\nBcc: x@y.com' })).body.reply_to).toBeUndefined(); // grep-limpio:ok
  });
  it('sobrio: sin logo (solo adjuntos del llamador), sin marca en html/text', async () => {
    const { body } = await enviar({ sobrio: true, adjuntos: [{ filename: 'd.xlsx', content: 'QQ==' }] });
    expect(body.attachments).toEqual([{ filename: 'd.xlsx', content: 'QQ==' }]);
    expect(body.html).not.toContain('cid:');
    expect(body.text).not.toContain('LIKIDA');
  });
  it('sobrio sin adjuntos: attachments vacío', async () => {
    expect((await enviar({ sobrio: true })).body.attachments).toEqual([]);
  });
  it('sobrio NO lleva List-Unsubscribe aunque venga listaBajaUrl; no sobrio sí', async () => {
    expect((await enviar({ sobrio: true, listaBajaUrl: 'https://x.mx/baja' })).body.headers).toBeUndefined();
    expect((await enviar({ listaBajaUrl: 'https://x.mx/baja' })).body.headers['List-Unsubscribe']).toBe('<https://x.mx/baja>');
  });
});
