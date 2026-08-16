import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ═══════════════════════════════════════════════════════════════════════════
// UNA CONVERSACIÓN DEL HISTORIAL DEL COPILOTO (0121) — lo que se fija:
//  1. La misma puerta que el chat (401/403 sin decir qué hay).
//  2. Un id que no es UUID se rechaza con 400 SIN viajar a la base.
//  3. Un id ajeno o inexistente es 404 — indistinguibles a propósito (el
//     anclaje por usuario vive en traerConversacionCopiloto).
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; rol: string } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const traerConversacionCopiloto = vi.fn(async (..._a: unknown[]) => (
  { id: 'c1', titulo: 'hola', mensajes: [{ rol: 'usuario', texto: 'hola', bloques: null }] }
));
vi.mock('@/lib/agents/copiloto-historial', () => ({
  traerConversacionCopiloto: (...a: unknown[]) => traerConversacionCopiloto(...a),
}));

const { GET } = await import('./route');

const UUID = '11111111-2222-3333-4444-555555555555';
const req = {} as NextRequest;
const conId = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  sesion = { userId: 'u-javier', rol: 'superadmin' };
  traerConversacionCopiloto.mockClear();
  traerConversacionCopiloto.mockResolvedValue(
    { id: 'c1', titulo: 'hola', mensajes: [{ rol: 'usuario', texto: 'hola', bloques: null }] },
  );
});

describe('la puerta', () => {
  it('sin sesión: 401', async () => {
    sesion = null;
    const r = await GET(req, conId(UUID));
    expect(r.status).toBe(401);
    expect(traerConversacionCopiloto).not.toHaveBeenCalled();
  });

  it('otro rol: 403', async () => {
    sesion = { userId: 'u-cliente', rol: 'contador' };
    const r = await GET(req, conId(UUID));
    expect(r.status).toBe(403);
    expect(traerConversacionCopiloto).not.toHaveBeenCalled();
  });
});

describe('la conversación', () => {
  it('id que no es UUID: 400 sin viajar a la base', async () => {
    const r = await GET(req, conId('no-un-uuid'));
    expect(r.status).toBe(400);
    expect(traerConversacionCopiloto).not.toHaveBeenCalled();
  });

  it('se trae anclada al userId de la sesión', async () => {
    const r = await GET(req, conId(UUID));
    expect(r.status).toBe(200);
    expect(traerConversacionCopiloto).toHaveBeenCalledWith('u-javier', UUID);
  });

  it('ajena o inexistente: 404 — indistinguibles a propósito', async () => {
    traerConversacionCopiloto.mockResolvedValueOnce(null as never);
    const r = await GET(req, conId(UUID));
    expect(r.status).toBe(404);
  });

  it('base caída: 502 con error, no un 404 que afirme "no existe"', async () => {
    traerConversacionCopiloto.mockRejectedValueOnce(new Error('base caída'));
    const r = await GET(req, conId(UUID));
    expect(r.status).toBe(502);
  });
});
