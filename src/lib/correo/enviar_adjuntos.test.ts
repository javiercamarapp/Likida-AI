import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Adjuntos del correo (buzón de facturas → contador): contrato con la API de Resend
// (https://resend.com/docs/api-reference/emails/send-email: `attachments[{filename, content (base64), content_type}]`,
// máximo 40 MB por correo DESPUÉS de codificar en base64) y los límites propios.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const correo = { asunto: 'Facturas aprobadas', avance: 'a', titulo: 't', parrafos: ['p'], porQueLoRecibes: 'Recibes esto porque eres el contador de la flota.' };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 'llave-de-prueba');
  vi.stubEnv('RESEND_EMAIL_DOMAIN', 'mail.likida.ai');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('enviarCorreo con adjuntos', () => {
  it('manda cada adjunto como {filename, content base64, content_type} DESPUÉS del logo en línea', async () => {
    const fetchFalso = vi.fn(async (_u: string, _init: RequestInit) => { void _u; void _init; return new Response(JSON.stringify({ id: 'c1' }), { status: 200 }); });
    vi.stubGlobal('fetch', fetchFalso);
    const { enviarCorreo } = await import('./enviar');
    const r = await enviarCorreo(['conta@flota.mx'], correo, {
      idempotencyKey: 'buzon-entrega:abc',
      adjuntos: [
        { filename: 'facturas.csv', content: Buffer.from('a,b\n1,2').toString('base64'), contentType: 'text/csv' },
        { filename: 'lote.zip', content: Buffer.from('PK').toString('base64') },
      ],
    });
    expect(r).toEqual({ ok: true, id: 'c1' });
    const init = fetchFalso.mock.calls[0][1];
    const body = JSON.parse(init.body as string);
    expect(body.attachments).toHaveLength(3);
    expect(body.attachments[0].content_disposition).toBe('inline');           // el logo sigue primero
    expect(body.attachments[1]).toEqual({ filename: 'facturas.csv', content: Buffer.from('a,b\n1,2').toString('base64'), content_type: 'text/csv' });
    expect(body.attachments[2]).toEqual({ filename: 'lote.zip', content: Buffer.from('PK').toString('base64') });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('buzon-entrega:abc');
  });

  it('rechaza ANTES de llamar a Resend lo que pasa del tope de adjuntos (28 MB crudos)', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    const { enviarCorreo, MAX_BYTES_ADJUNTOS_CORREO } = await import('./enviar');
    const enorme = Buffer.alloc(MAX_BYTES_ADJUNTOS_CORREO + 1024).toString('base64');
    const r = await enviarCorreo('conta@flota.mx', correo, { adjuntos: [{ filename: 'x.zip', content: enorme }] });
    expect(r).toMatchObject({ ok: false, motivo: 'rechazado' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sin adjuntos el cuerpo no cambia: solo el logo', async () => {
    const fetchFalso = vi.fn(async (_u: string, _init: RequestInit) => { void _u; void _init; return new Response(JSON.stringify({ id: 'c2' }), { status: 200 }); });
    vi.stubGlobal('fetch', fetchFalso);
    const { enviarCorreo } = await import('./enviar');
    await enviarCorreo('x@y.mx', correo);
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body as string).attachments).toHaveLength(1);
  });
});
