import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// `List-Unsubscribe` / `List-Unsubscribe-Post` (0266) — las cabeceras del
// MENSAJE (no del POST a Resend) que encienden el botón nativo "Cancelar
// suscripción" de Gmail/Yahoo. Van SOLO cuando el llamador trae `listaBajaUrl`
// — un correo transaccional (sin ella) no las lleva.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const correo = {
  asunto: 'Vi su vacante', avance: 'a', titulo: 't', parrafos: ['p'],
  porQueLoRecibes: 'Recibes esto porque tu empresa aparece en directorios públicos.',
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 'llave-de-prueba');
  vi.stubEnv('RESEND_EMAIL_DOMAIN', 'mail.likida.ai');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('enviarCorreo con listaBajaUrl', () => {
  it('agrega List-Unsubscribe y List-Unsubscribe-Post al CUERPO del mensaje', async () => {
    const fetchFalso = vi.fn(async (_u: string, _init: RequestInit) => { void _u; void _init; return new Response(JSON.stringify({ id: 'c1' }), { status: 200 }); });
    vi.stubGlobal('fetch', fetchFalso);
    const { enviarCorreo } = await import('./enviar');

    await enviarCorreo('prospecto@flota.mx', correo, {
      listaBajaUrl: 'https://app.likida.ai/api/correo/baja?e=a%40b.mx&t=xyz',
    });

    const body = JSON.parse(fetchFalso.mock.calls[0][1].body as string);
    expect(body.headers).toEqual({
      'List-Unsubscribe': '<https://app.likida.ai/api/correo/baja?e=a%40b.mx&t=xyz>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('sin listaBajaUrl, el cuerpo NO lleva headers — un transaccional no se da de baja', async () => {
    const fetchFalso = vi.fn(async (_u: string, _init: RequestInit) => { void _u; void _init; return new Response(JSON.stringify({ id: 'c1' }), { status: 200 }); });
    vi.stubGlobal('fetch', fetchFalso);
    const { enviarCorreo } = await import('./enviar');

    await enviarCorreo('cliente@flota.mx', correo);

    const body = JSON.parse(fetchFalso.mock.calls[0][1].body as string);
    expect(body.headers).toBeUndefined();
  });
});
