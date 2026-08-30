import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21, BAJO-MEDIO — esta ruta no tenía ninguna prueba. Fija la
// puerta de origen (CSRF explícito, SEG-9 generalizado) que se agregó aquí:
// registra un toque con service_role, autenticada solo por cookie de sesión.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; tenantId: string | null; rol: string } | null = null;
vi.mock('../puerta', () => ({
  sesionSuperadmin: async () => (sesion
    ? { error: null, sesion }
    : { error: new Response(null, { status: 401 }), sesion: null }),
}));

const insertados: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (v: Record<string, unknown>) => { insertados.push(v); return Promise.resolve({ error: null }); },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');

function postear(cuerpo: unknown, cabeceras: Record<string, string> = {}) {
  return POST(new Request('https://app.likida.ai/api/admin/mapa-prospectos/toque', {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo),
  }));
}

const TOQUE = { id: '11111111-1111-1111-1111-111111111111', canal: 'whatsapp', resumen: 'primer toque' };

beforeEach(() => {
  sesion = { userId: 'u-1', tenantId: 't-1', rol: 'superadmin' };
  insertados.length = 0;
});

describe('la puerta de origen (auditoría 21, BAJO-MEDIO)', () => {
  it('desde otro sitio: 403 y nada se inserta', async () => {
    const r = await postear(TOQUE, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(insertados).toHaveLength(0);
  });

  it('desde el panel (same-origin) sí registra', async () => {
    const r = await postear(TOQUE, { 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(insertados).toHaveLength(1);
  });
});

describe('la puerta de sesión sigue en pie', () => {
  it('sin sesión: 401 y nada se inserta', async () => {
    sesion = null;
    const r = await postear(TOQUE, { 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(401);
    expect(insertados).toHaveLength(0);
  });
});
