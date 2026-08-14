import { describe, it, expect, vi } from 'vitest';

// El pulso para el monitor externo (D4): la única promesa es que el status
// HTTP diga la verdad — 200 solo con la base respondiendo, 503 si no — y que
// el cuerpo no filtre un solo dato de negocio.

let dbFalla = false;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: async () => (dbFalla ? { count: null, error: { message: 'caída' } } : { count: 0, error: null }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');

describe('/api/health', () => {
  it('con la base viva: 200, ok true, y el cuerpo solo trae pulso (nada de negocio)', async () => {
    dbFalla = false;
    const r = await GET();
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.ok).toBe(true);
    expect(c.db).toBe('ok');
    expect(Object.keys(c).sort()).toEqual(['db', 'hora', 'ok', 'sentry', 'version']);
    // Ni tablas, ni tenants, ni correos: el health es público a propósito.
    expect(JSON.stringify(c)).not.toMatch(/tenant_id|@|supabase/i);
  });

  it('con la base caída: 503 y ok false — lo que un monitor entiende sin leer el cuerpo', async () => {
    dbFalla = true;
    const r = await GET();
    expect(r.status).toBe(503);
    expect((await r.json()).ok).toBe(false);
  });
});
