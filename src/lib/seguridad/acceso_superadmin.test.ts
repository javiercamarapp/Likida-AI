import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const insert = vi.fn(async (..._a: unknown[]) => ({ error: null as { message: string } | null }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => ({ insert: (r: unknown) => insert(t, r) }) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const m = await import('./acceso_superadmin');

beforeEach(() => { insert.mockClear(); m._reiniciarDedupParaPruebas(); });
afterEach(() => vi.unstubAllEnvs());

const base = { actor: 'u1', tenantId: 't1', tipo: 'descarga' as const, ruta: '/api/export/liquidaciones?tenant=t1&desde=2026-01-01' };

describe('bitácora de acceso del superadmin', () => {
  it('apagada por omisión: no toca la base', async () => {
    await m.registrarAccesoSuperadmin(base);
    expect(insert).not.toHaveBeenCalled();
  });
  it('encendida: escribe SOLO la ruta, sin query', async () => {
    vi.stubEnv('LIKIDA_BITACORA_ACCESO_SUPERADMIN', 'activo');
    await m.registrarAccesoSuperadmin(base);
    expect(insert).toHaveBeenCalledWith('superadmin_acceso', { actor: 'u1', tenant_id: 't1', tipo: 'descarga', ruta: '/api/export/liquidaciones', detalle: {} });
  });
  it('dedup por minuto, pero otra ruta u otro tipo sí escribe', async () => {
    vi.stubEnv('LIKIDA_BITACORA_ACCESO_SUPERADMIN', 'activo');
    await m.registrarAccesoSuperadmin(base);
    await m.registrarAccesoSuperadmin(base);
    await m.registrarAccesoSuperadmin({ ...base, ruta: '/api/export/poliza' });
    await m.registrarAccesoSuperadmin({ ...base, tipo: 'lectura' });
    expect(insert).toHaveBeenCalledTimes(3);
  });
  it('un error de la base o una tabla ausente no lanza', async () => {
    vi.stubEnv('LIKIDA_BITACORA_ACCESO_SUPERADMIN', 'activo');
    insert.mockResolvedValueOnce({ error: { message: 'relation "superadmin_acceso" does not exist' } });
    await expect(m.registrarAccesoSuperadmin(base)).resolves.toBeUndefined();
    insert.mockRejectedValueOnce(new Error('red'));
    await expect(m.registrarAccesoSuperadmin({ ...base, ruta: '/z' })).resolves.toBeUndefined();
  });
  it('rutaSinQuery acota a 200 y quita hash', () => {
    expect(m.rutaSinQuery('/a/b#x')).toBe('/a/b');
    expect(m.rutaSinQuery('/' + 'x'.repeat(300)).length).toBe(200);
  });
});
