import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · BE-20 — `/api/dashboard/chat` era la única ruta cara del
// panel sin rate limit: 40 POST en paralelo con `gastadoHoy = $0` pasaban los
// 40. Tres POST seguidos sobre un límite de dos: el tercero es 429 y el
// analista no se toca. El límite se mide por usuario, no por IP.
// ═══════════════════════════════════════════════════════════════════════════

const ejecutarAnalista = vi.fn(async () => ({ bloques: [{ tipo: 'texto', texto: 'ok' }], costoPorModelo: {} }));
let permitidos = 2;
const rateLimit = vi.fn(async () => permitidos-- > 0);

vi.mock('@/lib/auth/session', () => ({
  getSessionTenant: vi.fn(async () => ({ userId: 'u-77', tenantId: 't1', rol: 'flota_admin', nombre: 'Ana' })),
}));
vi.mock('./tenant', () => ({ tenantEfectivoChat: vi.fn(async () => ({ tenantId: 't1', nombreFlota: 'Flota' })) }));
vi.mock('./tope', () => ({ topeDiaUsd: () => 1, gastoChatHoyUsd: vi.fn(async () => 0) }));
vi.mock('@/lib/likida/costos', () => ({ registrarCosto: vi.fn(async () => undefined), faseDeModelo: () => 'chat' }));
vi.mock('@/lib/agents/analista', () => ({ ejecutarAnalista: (...a: unknown[]) => ejecutarAnalista(...(a as [])) }));
vi.mock('@/lib/likida/chat/conversaciones', () => ({ guardarIntercambio: vi.fn(async () => null) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');

function peticion() {
  const req = new Request('http://likida.test/api/dashboard/chat', {
    method: 'POST',
    body: JSON.stringify({ mensajes: [{ rol: 'usuario', texto: '¿cuánto llevo de diésel?' }] }),
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
  }) as unknown as Record<string, unknown>;
  req.nextUrl = new URL('http://likida.test/api/dashboard/chat');
  return req as never;
}

async function drenar(res: Response) {
  const lector = res.body?.getReader();
  if (!lector) return;
  while (!(await lector.read()).done) { /* drenar */ }
}

beforeEach(() => { permitidos = 2; rateLimit.mockClear(); ejecutarAnalista.mockClear(); });

describe('BE-20: límite de tasa por usuario en el chat', () => {
  it('tres POST seguidos sobre un límite de dos: el tercero es 429 y no llega al analista', async () => {
    const r1 = await POST(peticion()) as Response; await drenar(r1);
    const r2 = await POST(peticion()) as Response; await drenar(r2);
    const r3 = await POST(peticion()) as Response;
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r3.status).toBe(429);
    expect(ejecutarAnalista).toHaveBeenCalledTimes(2);
    // La llave lleva al usuario, no la IP: un contralor no bloquea a otro de
    // la misma oficina (misma IP), y uno solo no puede rafaguear con dos IPs.
    expect(rateLimit).toHaveBeenLastCalledWith('chat:u-77', expect.any(Number), 60_000);
    expect((await r3.json()).error).toMatch(/espera/i);
  });
});
