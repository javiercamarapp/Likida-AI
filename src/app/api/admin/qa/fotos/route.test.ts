import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21, BAJO-MEDIO — esta ruta no tenía ninguna prueba. Fija la
// puerta de origen (CSRF explícito, SEG-9 generalizado) en POST (sube fotos)
// y PATCH (firma la verdad-de-terreno) — ambas autenticadas solo por cookie.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; tenantId: string | null; rol: string } | null = null;
vi.mock('../puerta', () => ({
  sesionSuperadmin: async () => (sesion
    ? { error: null, sesion }
    : { error: new Response(null, { status: 401 }), sesion: null }),
}));

const subirFotos = vi.fn(async () => ({ ok: true, datos: { fotos: [], resultados: [] } }));
const confirmarVerdadTerreno = vi.fn(async () => ({ ok: true, datos: { path: 'p/1.jpg' } }));
vi.mock('@/lib/admin/qa-storage', () => ({
  leerManifiesto: async () => ({ ok: true, datos: [] }),
  subirFotos: (...a: unknown[]) => subirFotos(...(a as [])),
  firmarRuta: async () => 'https://firmada/1',
  firmarRutas: async () => new Map(),
  confirmarVerdadTerreno: (...a: unknown[]) => confirmarVerdadTerreno(...(a as [])),
  BUCKET_QA_FOTOS: 'qa-fotos',
}));
vi.mock('@/lib/admin/qa-tipos', () => ({
  validarVerdadTerreno: (v: unknown) => ({ ok: true, datos: v }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { POST, PATCH } = await import('./route');

function postearForm(cabeceras: Record<string, string> = {}) {
  const form = new FormData();
  form.set('archivo', new File(['x'], 'ticket.jpg', { type: 'image/jpeg' }));
  return POST(new Request('https://app.likida.ai/api/admin/qa/fotos', { method: 'POST', headers: cabeceras, body: form }));
}

function patchear(cuerpo: unknown, cabeceras: Record<string, string> = {}) {
  return PATCH(new Request('https://app.likida.ai/api/admin/qa/fotos', {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo),
  }));
}

const UUID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  sesion = { userId: 'u-1', tenantId: 't-1', rol: 'superadmin' };
  subirFotos.mockClear(); confirmarVerdadTerreno.mockClear();
});

describe('POST — la puerta de origen (auditoría 21, BAJO-MEDIO)', () => {
  it('desde otro sitio: 403 y nada se sube', async () => {
    const r = await postearForm({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(subirFotos).not.toHaveBeenCalled();
  });

  it('desde el panel (same-origin) sí sube', async () => {
    const r = await postearForm({ 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(subirFotos).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH — la puerta de origen (auditoría 21, BAJO-MEDIO)', () => {
  it('desde otro sitio: 403 y no se firma nada', async () => {
    const r = await patchear({ fotoId: UUID, verdad: {} }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(confirmarVerdadTerreno).not.toHaveBeenCalled();
  });

  it('desde el panel (same-origin) sí firma', async () => {
    const r = await patchear({ fotoId: UUID, verdad: {} }, { 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(confirmarVerdadTerreno).toHaveBeenCalledTimes(1);
  });
});
