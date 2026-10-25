import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A37-S26-04: varios buzones de una misma empresa no se ven entre sí.
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const correo = { asunto: 'Hola', avance: 'a', titulo: 't', parrafos: ['p'], porQueLoRecibes: 'Sintético.' };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 'llave-de-prueba');
  vi.stubEnv('RESEND_EMAIL_DOMAIN', 'mail.likida.ai');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function cuerpoDe(opciones: Record<string, unknown>) {
  const f = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ id: 'c1' }), { status: 200 }));
  vi.stubGlobal('fetch', f);
  const { enviarCorreo } = await import('./enviar');
  await enviarCorreo(['a@empresa.test', 'b@empresa.test', 'c@empresa.test'], correo, opciones);
  return JSON.parse(f.mock.calls[0][1].body as string);
}

describe('A37-S26-04 copiasOcultas', () => {
  it('con copiasOcultas: el primero va en to y los demás en bcc', async () => {
    const b = await cuerpoDe({ copiasOcultas: true });
    expect(b.to).toEqual(['a@empresa.test']);
    expect(b.bcc).toEqual(['b@empresa.test', 'c@empresa.test']);
  });
  it('sin la opción: comportamiento de siempre (todos en to)', async () => {
    const b = await cuerpoDe({});
    expect(b.to).toHaveLength(3);
    expect(b.bcc).toBeUndefined();
  });
});
