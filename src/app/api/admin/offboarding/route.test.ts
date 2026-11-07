import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

const sesionSuperadmin = vi.fn();
vi.mock('@/lib/auth/api-superadmin', () => ({ sesionSuperadmin: () => sesionSuperadmin() }));
vi.mock('@/lib/auth/csrf', () => ({ vieneDeNuestroSitio: () => true }));
const exportarFlota = vi.fn();
vi.mock('@/lib/likida/offboarding/exportar', async (o) => ({ ...(await o<Record<string, unknown>>()), exportarFlota: (...a: unknown[]) => exportarFlota(...a) }));
vi.mock('@/lib/seguridad/acceso_superadmin', () => ({ registrarAccesoSuperadmin: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { POST } = await import('./route');
const T = '11111111-1111-4111-8111-111111111111';
const req = (b: unknown) => new Request('https://x/api/admin/offboarding', { method: 'POST', body: JSON.stringify(b) });

beforeEach(() => { sesionSuperadmin.mockReset(); exportarFlota.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/admin/offboarding', () => {
  it('apagada: 404 sin tocar sesión', async () => {
    expect((await POST(req({ tenantId: T }))).status).toBe(404);
    expect(sesionSuperadmin).not.toHaveBeenCalled();
  });
  it('encendida pero sin superadmin: la puerta decide', async () => {
    vi.stubEnv('LIKIDA_OFFBOARDING_EXPORTACION', 'activo');
    sesionSuperadmin.mockResolvedValue({ error: new NextResponse(null, { status: 403 }), sesion: null });
    expect((await POST(req({ tenantId: T }))).status).toBe(403);
    expect(exportarFlota).not.toHaveBeenCalled();
  });
  it('tenantId inválido: 400', async () => {
    vi.stubEnv('LIKIDA_OFFBOARDING_EXPORTACION', 'activo');
    sesionSuperadmin.mockResolvedValue({ error: null, sesion: { userId: 'u1' } });
    expect((await POST(req({ tenantId: 'x' }))).status).toBe(400);
  });
  it('paquete incompleto: 409 con el manifiesto; completo: 200 con huella', async () => {
    vi.stubEnv('LIKIDA_OFFBOARDING_EXPORTACION', 'activo');
    sesionSuperadmin.mockResolvedValue({ error: null, sesion: { userId: 'u1' } });
    exportarFlota.mockResolvedValueOnce({ ok: false, motivo: 'incompleto', paquete: { manifiesto: { completo: false } } });
    expect((await POST(req({ tenantId: T }))).status).toBe(409);
    exportarFlota.mockResolvedValueOnce({ ok: true, exportacionId: 'e1', paquete: { huellaManifiesto: 'h', manifiestoJson: '{}', archivos: [{ nombre: 'a.jsonl', contenido: '', sha256: 's', filas: 0 }] } });
    const r = await POST(req({ tenantId: T }));
    expect(r.status).toBe(200);
    expect((await r.json()).huellaManifiesto).toBe('h');
  });
});
