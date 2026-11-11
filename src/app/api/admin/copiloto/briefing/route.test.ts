import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

let sesion: { userId: string } | null = { userId: 'u-1' };
vi.mock('../puerta', () => ({
  sesionSuperadmin: async () => (sesion ? { error: null, sesion } : { error: NextResponse.json({ error: 'no' }, { status: 401 }), sesion: null }),
}));
const armarBriefing = vi.fn(async () => ({ tarjetas: [{ id: 'sin_pendientes' }], fuentesCiegas: [] }));
vi.mock('@/lib/admin/copiloto-briefing', () => ({ armarBriefing: () => armarBriefing() }));
const rateLimit = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));

import { GET } from './route';

beforeEach(() => { sesion = { userId: 'u-1' }; armarBriefing.mockClear(); rateLimit.mockClear(); rateLimit.mockResolvedValue(true); });

describe('GET /api/admin/copiloto/briefing', () => {
  it('sin sesión superadmin: 401 y no lee nada', async () => {
    sesion = null;
    expect((await GET()).status).toBe(401);
    expect(armarBriefing).not.toHaveBeenCalled();
  });
  it('con sesión: devuelve el briefing sin caché', async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect((await r.json()).tarjetas).toHaveLength(1);
  });
  it('tope por minuto: 429 sin leer', async () => {
    rateLimit.mockResolvedValue(false);
    expect((await GET()).status).toBe(429);
    expect(armarBriefing).not.toHaveBeenCalled();
  });
});
