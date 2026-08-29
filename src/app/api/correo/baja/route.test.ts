import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /api/correo/baja (0266) — el contrato que importa:
//
//  · GET nunca suprime — solo enseña la tarjeta de confirmación (un escáner
//    corporativo que prefetchea el enlace no puede dar de baja a nadie).
//  · POST es la única vía que muta, y solo con token válido.
//  · un token inválido o de otro correo nunca suprime nada.
// ═══════════════════════════════════════════════════════════════════════════

const suprimirCorreo = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/likida/agentes/enviador', () => ({ suprimirCorreo: (...a: unknown[]) => suprimirCorreo(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET, POST } = await import('./route');
const { firmarBaja } = await import('@/lib/correo/baja');

const envAntes = process.env.LIKIDA_BAJA_SECRET;
beforeEach(() => {
  process.env.LIKIDA_BAJA_SECRET = 'secreto-de-prueba-de-la-ruta';
  suprimirCorreo.mockClear();
});
afterEach(() => {
  if (envAntes === undefined) delete process.env.LIKIDA_BAJA_SECRET;
  else process.env.LIKIDA_BAJA_SECRET = envAntes;
});

function url(correo: string, token: string): string {
  return `https://app.likida.ai/api/correo/baja?e=${encodeURIComponent(correo)}&t=${encodeURIComponent(token)}`;
}

describe('GET — la tarjeta de confirmación, NUNCA suprime', () => {
  it('con token válido, muestra la tarjeta y NO llama a suprimirCorreo', async () => {
    const token = firmarBaja('prospecto@flota.mx')!;
    const r = await GET(new Request(url('prospecto@flota.mx', token)));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toMatch(/darme de baja/i);
    expect(suprimirCorreo).not.toHaveBeenCalled();
  });

  it('con token inválido, 400 y ninguna supresión', async () => {
    const r = await GET(new Request(url('prospecto@flota.mx', 'token-falso')));
    expect(r.status).toBe(400);
    expect(suprimirCorreo).not.toHaveBeenCalled();
  });

  it('sin parámetros, 400', async () => {
    const r = await GET(new Request('https://app.likida.ai/api/correo/baja'));
    expect(r.status).toBe(400);
    expect(suprimirCorreo).not.toHaveBeenCalled();
  });
});

describe('POST — la única vía que de verdad suprime', () => {
  it('con token válido, suprime EXACTAMENTE ese correo y responde 200', async () => {
    const token = firmarBaja('prospecto@flota.mx')!;
    const r = await POST(new Request(url('prospecto@flota.mx', token), { method: 'POST' }));
    expect(r.status).toBe(200);
    expect(suprimirCorreo).toHaveBeenCalledWith('prospecto@flota.mx', expect.any(String));
  });

  it('con token de OTRO correo, no suprime nada', async () => {
    const token = firmarBaja('uno@x.mx')!;
    const r = await POST(new Request(url('otro@x.mx', token), { method: 'POST' }));
    expect(r.status).toBe(400);
    expect(suprimirCorreo).not.toHaveBeenCalled();
  });

  it('con token tocado, no suprime nada', async () => {
    const token = firmarBaja('prospecto@flota.mx')!;
    const alterado = token.slice(0, -2) + 'zz';
    const r = await POST(new Request(url('prospecto@flota.mx', alterado), { method: 'POST' }));
    expect(r.status).toBe(400);
    expect(suprimirCorreo).not.toHaveBeenCalled();
  });

  it('funciona sin cuerpo (el one-click de RFC 8058 manda `List-Unsubscribe=One-Click` como body, que aquí se ignora)', async () => {
    const token = firmarBaja('prospecto@flota.mx')!;
    const r = await POST(new Request(url('prospecto@flota.mx', token), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    }));
    expect(r.status).toBe(200);
    expect(suprimirCorreo).toHaveBeenCalledWith('prospecto@flota.mx', expect.any(String));
  });
});
