import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA LISTA DEL HISTORIAL DEL COPILOTO (0121) — lo que se fija:
//  1. La misma puerta que el chat: sin sesión 401, otro rol 403, sin decir
//     qué hay detrás.
//  2. La lista sale anclada al userId DE LA SESIÓN, jamás de un parámetro.
//  3. La base caída es 502 CON error — una lista vacía por error afirmaría
//     "no has chateado".
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; rol: string } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const listarConversacionesCopiloto = vi.fn(async (..._a: unknown[]) => (
  [{ id: 'c1', titulo: '¿Qué espera decisión hoy?', actualizadoEn: '2026-08-16T12:00:00Z' }]
));
vi.mock('@/lib/agents/copiloto-historial', () => ({
  listarConversacionesCopiloto: (...a: unknown[]) => listarConversacionesCopiloto(...a),
}));

const { GET } = await import('./route');

beforeEach(() => {
  sesion = { userId: 'u-javier', rol: 'superadmin' };
  listarConversacionesCopiloto.mockClear();
  listarConversacionesCopiloto.mockResolvedValue(
    [{ id: 'c1', titulo: '¿Qué espera decisión hoy?', actualizadoEn: '2026-08-16T12:00:00Z' }],
  );
});

describe('la puerta', () => {
  it('sin sesión: 401 y no se consulta nada', async () => {
    sesion = null;
    const r = await GET();
    expect(r.status).toBe(401);
    expect(listarConversacionesCopiloto).not.toHaveBeenCalled();
  });

  it('con sesión de flota_admin: 403 — el historial del copiloto es SOLO del superadmin', async () => {
    sesion = { userId: 'u-cliente', rol: 'flota_admin' };
    const r = await GET();
    expect(r.status).toBe(403);
    expect(listarConversacionesCopiloto).not.toHaveBeenCalled();
  });
});

describe('la lista', () => {
  it('sale anclada al userId de la sesión', async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const d = await r.json() as { conversaciones: Array<{ id: string }> };
    expect(d.conversaciones).toHaveLength(1);
    expect(listarConversacionesCopiloto).toHaveBeenCalledWith('u-javier');
  });

  it('base caída: 502 con error, JAMÁS una lista vacía que afirme "no has chateado"', async () => {
    listarConversacionesCopiloto.mockRejectedValueOnce(new Error('base caída'));
    const r = await GET();
    expect(r.status).toBe(502);
    const d = await r.json() as { error?: string; conversaciones?: unknown };
    expect(d.error).toBeTruthy();
    expect(d.conversaciones).toBeUndefined();
  });
});
