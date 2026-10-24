// A37-S24-07 y A37-S24-08 — privacidad del correo saliente.
//  · el log de un rechazo de Resend NO lleva el cuerpo (puede traer la
//    dirección del destinatario): solo el nombre/código del error;
//  · con `copiasOcultas`, solo el principal va en `to` y el resto en `bcc`:
//    en una campaña en frío ningún contacto ve las direcciones de los demás.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const correo = { asunto: 'Hola', avance: 'a', titulo: 't', parrafos: ['p'], porQueLoRecibes: 'Lo recibes por X.' };

beforeEach(() => {
  vi.resetModules();
  logger.error.mockClear();
  vi.stubEnv('RESEND_API_KEY', 'llave-de-prueba');
  vi.stubEnv('RESEND_EMAIL_DOMAIN', 'mail.likida.ai');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function enviar(para: string | string[], op: Record<string, unknown>, respuesta: Response) {
  const f = vi.fn(async (_u: string, _i: RequestInit) => { void _u; void _i; return respuesta; });
  vi.stubGlobal('fetch', f);
  const { enviarCorreo } = await import('./enviar');
  const r = await enviarCorreo(para, correo, op); // grep-limpio:ok
  return { r, body: JSON.parse(f.mock.calls[0][1].body as string) };
}

describe('A37-S24-07 — el log de rechazo no lleva direcciones', () => {
  it('registra el nombre del error y no el cuerpo crudo', async () => {
    const cuerpo = JSON.stringify({ statusCode: 422, name: 'validation_error', message: 'Invalid `to` field: persona@ejemplo.mx rebotó' });
    await enviar('persona@ejemplo.mx', {}, new Response(cuerpo, { status: 422 }));
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, ctx] = logger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(ctx)).not.toContain('persona@ejemplo.mx');
    expect(ctx).toMatchObject({ status: 422, codigo: 'validation_error' });
  });

  it('un cuerpo que no es JSON no se loguea', async () => {
    await enviar('persona@ejemplo.mx', {}, new Response('persona@ejemplo.mx no existe', { status: 500 }));
    const [, ctx] = logger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(ctx)).not.toContain('persona@ejemplo.mx');
  });
});

describe('A37-S24-08 — copias ocultas', () => {
  it('con copiasOcultas el principal va en to y el resto en bcc', async () => {
    const { body } = await enviar(['a@x.mx', 'b@x.mx', 'c@x.mx'], { copiasOcultas: true }, new Response('{"id":"c1"}', { status: 200 }));
    expect(body.to).toEqual(['a@x.mx']);
    expect(body.bcc).toEqual(['b@x.mx', 'c@x.mx']);
  });

  it('sin la opción, el comportamiento anterior (todos en to) se conserva', async () => {
    const { body } = await enviar(['a@x.mx', 'b@x.mx'], {}, new Response('{"id":"c1"}', { status: 200 }));
    expect(body.to).toEqual(['a@x.mx', 'b@x.mx']);
    expect(body.bcc).toBeUndefined();
  });

  it('un solo destinatario no genera bcc', async () => {
    const { body } = await enviar('a@x.mx', { copiasOcultas: true }, new Response('{"id":"c1"}', { status: 200 }));
    expect(body.to).toEqual(['a@x.mx']);
    expect(body.bcc).toBeUndefined();
  });
});
