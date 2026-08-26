import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// BACKEND-19C2-2 — el chat de onboarding gastaba presupuesto de IA sin límite
// de tasa: solo el tope diario en USD (dentro de `responderEntrevista`) lo
// frenaba, y ese tope es COMPARTIDO por todo el tenant (OCR de WhatsApp,
// cuadre, Redactor). Un usuario golpeando la ruta podía agotarlo por su
// cuenta y dejar sin agente al resto de la flota el resto del día.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; tenantId: string | null; rol: string; nombre: string } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: (rol: string) => rol !== 'operador' }));
vi.mock('@/app/api/dashboard/chat/tenant', () => ({
  tenantEfectivoChat: async () => ({ tenantId: 't-1', nombreFlota: 'flota' }),
}));

const getPerfilCrudo = vi.fn(async () => ({}));
vi.mock('@/lib/likida/repo', () => ({ getPerfilCrudo: (...a: unknown[]) => getPerfilCrudo(...(a as [])) }));

const responderEntrevista = vi.fn(async () => ({
  texto: 'ok', chips: [], perfilListo: false, elegiblePeaje: null, guardado: true,
}));
vi.mock('@/lib/likida/perfil/entrevista-agente', () => ({
  responderEntrevista: (...a: unknown[]) => responderEntrevista(...(a as [])),
}));

let permitido = true;
const rateLimit = vi.fn(async () => permitido);
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');

function postear(cuerpo: unknown = { mensajes: [{ rol: 'usuario', texto: 'hola' }] }) {
  const req = new Request('http://likida.test/api/dashboard/onboarding-chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  }) as unknown as Record<string, unknown>;
  // NextRequest.nextUrl — lo único que la ruta le pide es searchParams.
  req.nextUrl = new URL('http://likida.test/api/dashboard/onboarding-chat');
  return POST(req as never);
}

beforeEach(() => {
  sesion = { userId: 'u-1', tenantId: 't-1', rol: 'dueno', nombre: 'D' };
  permitido = true;
  rateLimit.mockClear(); responderEntrevista.mockClear(); getPerfilCrudo.mockClear();
});

describe('la puerta', () => {
  it('sin sesión: 401; sin acceso a la ruta: 403 — sin tocar el modelo', async () => {
    sesion = null;
    expect((await postear()).status).toBe(401);
    sesion = { userId: 'u-1', tenantId: 't-1', rol: 'operador', nombre: 'O' };
    expect((await postear()).status).toBe(403);
    expect(responderEntrevista).not.toHaveBeenCalled();
  });

  it('BACKEND-19C2-2: excedido el límite de tasa, 429 sin tocar el modelo', async () => {
    permitido = false;
    const r = await postear();
    expect(r.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith('onboarding-chat:u-1', expect.any(Number), 60_000);
    expect(responderEntrevista).not.toHaveBeenCalled();
  });

  it('con sesión válida y dentro del límite, sí llega al agente', async () => {
    const r = await postear();
    expect(r.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith('onboarding-chat:u-1', expect.any(Number), 60_000);
    // El body es un stream NDJSON; basta con que el agente se haya invocado.
    await r.text();
    expect(responderEntrevista).toHaveBeenCalledTimes(1);
  });
});
