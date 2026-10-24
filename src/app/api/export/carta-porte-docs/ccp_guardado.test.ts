import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-P-04: descargar el PDF/XML guardados de un CCP timbrado. Mismas puertas que el resto de la exportación; el archivo solo sale
// si la fila es de la flota de la sesión.
let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } = { ok: true, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rol: 'flota_admin' };
const descargarCcp = vi.fn();
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => ({ userId: 'u-1' }) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/carta_porte_docs/repo', () => ({}));
vi.mock('@/lib/likida/carta_porte_docs/ccp_respuesta_repo', () => ({ descargarCcp: (...a: unknown[]) => descargarCcp(...a) }));

import { GET } from './route';

const CCP = '55555555-5555-4555-8555-555555555555';
const peticion = (qs: string) => new Request(`https://app.likida.ai/api/export/carta-porte-docs${qs}`);

beforeEach(() => {
  descargarCcp.mockReset();
  tenant = { ok: true, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rol: 'flota_admin' };
});

describe('A37-P-04: ?ccp=&archivo=', () => {
  it('entrega el PDF de la flota de la sesión como descarga sin caché', async () => {
    descargarCcp.mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]), nombre: 'ccp-UUID-1.pdf', mime: 'application/pdf' });
    const r = await GET(peticion(`?ccp=${CCP}&archivo=pdf`));
    expect(r.status).toBe(200);
    expect(descargarCcp).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CCP, 'pdf');
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="ccp-UUID-1.pdf"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it('un CCP que no es de la flota (la lectura filtrada por tenant no lo halla) es 404', async () => {
    descargarCcp.mockResolvedValue(null);
    expect((await GET(peticion(`?ccp=${CCP}&archivo=xml`))).status).toBe(404);
  });

  it('id o tipo inválidos son 400 y no tocan la base', async () => {
    expect((await GET(peticion('?ccp=../../etc&archivo=pdf'))).status).toBe(400);
    expect((await GET(peticion(`?ccp=${CCP}&archivo=exe`))).status).toBe(400);
    expect((await GET(peticion('?ccp=&archivo=pdf'))).status).toBe(400);
    expect(descargarCcp).not.toHaveBeenCalled();
  });

  it('sin sesión o con un rol sin el área, no entrega nada', async () => {
    tenant = { ok: false, status: 401, motivo: 'sin sesión' };
    expect((await GET(peticion(`?ccp=${CCP}&archivo=pdf`))).status).toBe(401);
    tenant = { ok: true, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rol: 'vendedor' };
    expect((await GET(peticion(`?ccp=${CCP}&archivo=pdf`))).status).toBe(403);
    expect(descargarCcp).not.toHaveBeenCalled();
  });

  it('un fallo de descarga es 500 con mensaje genérico (no se filtra la causa)', async () => {
    descargarCcp.mockRejectedValue(new Error('storage: bucket secreto'));
    const r = await GET(peticion(`?ccp=${CCP}&archivo=pdf`));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('bucket');
  });
});
