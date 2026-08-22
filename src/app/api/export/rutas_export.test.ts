import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · A21 — las cuatro rutas de export tenían CERO líneas
// ejecutadas, y una de ellas documenta un IDOR ya corregido: la ruta
// autorizaba por SESIÓN y por TENANT y ahí se detenía; cualquier usuario de
// la flota —un OPERADOR incluido— bajaba el PDF de la liquidación de
// cualquier compañero con el id en la URL. El arreglo son tres cosas
// encadenadas (área `dinero`, `puedeExportar`, `.eq('tenant_id')`) y ninguna
// se ejercía. Aquí se anclan las tres en las cuatro rutas, con los módulos
// REALES de permisos y visibilidad — lo que se dobla es la base y la sesión.
// ═══════════════════════════════════════════════════════════════════════════

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// La base: una consulta a `liquidacion` que registra sus filtros, y el
// storage que firma. `filaPdf` es lo que devuelve `.maybeSingle()`.
let filaPdf: { pdf_url: string | null } | null = { pdf_url: 't-1/v-1.pdf' };
const filtros: Array<[string, unknown]> = [];
const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://storage/firmada' }, error: null }));
const rpc = vi.fn(async () => ({ error: null }));
function builderLiquidacion() {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return b; },
    order: () => b,
    range: () => b,
    maybeSingle: async () => ({ data: filaPdf, error: null }),
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: liquidaciones, error: null, count: liquidaciones.length }).then(res, rej),
  });
  return b;
}
let liquidaciones: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => builderLiquidacion(),
    storage: { from: () => ({ createSignedUrl }) },
    rpc,
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

// Los generadores de las otras dos rutas: dobles que registran el tenant con
// el que se les llamó — lo que importa es que sea el de la SESIÓN.
const exportarAprobadas = vi.fn(async (_t: string, _f: string) => ({ filas: [{ a: 1 }], ids: ['f-1'], recortado: false }));
const marcarExportadas = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/likida/proveedores', () => ({
  exportarAprobadas: (...a: [string, string]) => exportarAprobadas(...a),
  marcarExportadas: () => marcarExportadas(),
}));
vi.mock('@/lib/likida/agentes/corridas', () => ({ registrarCorrida: async () => {} }));
const bitacoraRmf918 = vi.fn(async (_t: string, _d: string): Promise<unknown> => ({ cruces: [] }));
vi.mock('@/lib/likida/intake/desglose_peaje', () => ({
  bitacoraRmf918: (...a: [string, string]) => bitacoraRmf918(...a),
  bitacoraACsv: () => 'csv-bitacora',
}));

const pdf = await import('./pdf/[id]/route');
const liq = await import('./liquidaciones/route');
const prov = await import('./facturas-proveedor/route');
const bit = await import('./bitacora-peaje/route');

const req = (url: string) => new Request(url);
const LIQ = '11111111-2222-3333-4444-555555555555';
const GET_PDF = () => pdf.GET(req(`https://app.likida.ai/api/export/pdf/${LIQ}`), { params: Promise.resolve({ id: LIQ }) });
const GET_LIQ = () => liq.GET(req('https://app.likida.ai/api/export/liquidaciones'));
const GET_PROV = (f = '') => prov.GET(req(`https://app.likida.ai/api/export/facturas-proveedor${f ? `?formato=${f}` : ''}`));
const GET_BIT = (d = 'd-1') => bit.GET(req(`https://app.likida.ai/api/export/bitacora-peaje${d ? `?desglose=${d}` : ''}`));

const RUTAS = [
  ['pdf/[id]', GET_PDF],
  ['liquidaciones', GET_LIQ],
  ['facturas-proveedor', GET_PROV],
  ['bitacora-peaje', GET_BIT],
] as const;

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' };
  filaPdf = { pdf_url: 't-1/v-1.pdf' };
  filtros.length = 0;
  liquidaciones = [];
  createSignedUrl.mockClear(); rpc.mockClear();
  exportarAprobadas.mockClear(); bitacoraRmf918.mockClear();
});

describe.each(RUTAS)('export/%s — las tres puertas del IDOR documentado', (_nombre, GET) => {
  it('sin credencial: el status de resolverTenantApi, sin tocar base ni storage', async () => {
    tenant = { ok: false, status: 401, motivo: 'No autorizado' };
    const r = await GET();
    expect(r.status).toBe(401);
    expect(filtros).toEqual([]);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(exportarAprobadas).not.toHaveBeenCalled();
    expect(bitacoraRmf918).not.toHaveBeenCalled();
  });

  it('OPERADOR (solo lo suyo): 403 — el IDOR original', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'operador' };
    const r = await GET();
    expect(r.status).toBe(403);
    expect(filtros).toEqual([]);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('ENCARGADO (puede exportar pero NO ve dinero): 403 por área, con el mismo texto que la pantalla', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'encargado' };
    const r = await GET();
    expect(r.status).toBe(403);
    expect(await r.text()).toContain('no ve las cifras de dinero');
  });

  it('un rol desconocido falla CERRADO: 403', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'rol_inventado' };
    expect((await GET()).status).toBe(403);
  });

  it.each(['contador', 'flota_admin', 'superadmin'])('%s (dinero + exporta) pasa la puerta', async (rol) => {
    tenant = { ok: true, tenantId: 't-1', rol };
    const r = await GET();
    expect([200, 302]).toContain(r.status);
  });
});

describe('export/pdf/[id] — el tenant es el de la SESIÓN, no el de la URL', () => {
  it('la lectura de la liquidación va acotada a tenant_id de la sesión y al id pedido', async () => {
    const r = await GET_PDF();
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://storage/firmada');
    expect(filtros).toEqual(expect.arrayContaining([['id', LIQ], ['tenant_id', 't-1']]));
  });

  it('un id de OTRA flota (la consulta acotada no lo encuentra) es 404, no la URL firmada', async () => {
    filaPdf = null;
    const r = await GET_PDF();
    expect(r.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('fila sin PDF también es 404: no se distingue "no existe" de "existe sin papel"', async () => {
    filaPdf = { pdf_url: null };
    expect((await GET_PDF()).status).toBe(404);
  });

  it('la descarga se registra con el rol real (0114) y nunca impide la descarga', async () => {
    rpc.mockRejectedValueOnce(new Error('rpc caída'));
    const r = await GET_PDF();
    expect(r.status).toBe(302);
    tenant = { ok: true, tenantId: 't-1', rol: 'superadmin' };
    await GET_PDF();
    expect(rpc).toHaveBeenLastCalledWith('registrar_descarga_liquidacion', expect.objectContaining({ p_tenant: 't-1', p_rol: 'superadmin', p_liquidacion: LIQ }));
  });

  it('si storage no firma, 502 y nada de redirigir a una URL vacía', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: '' }, error: null });
    expect((await GET_PDF()).status).toBe(502);
  });
});

describe('export/liquidaciones — CSV acotado al tenant', () => {
  it('consulta con tenant_id de la sesión y sale como CSV adjunto', async () => {
    liquidaciones = [{ created_at: '2026-08-01', total_comprobado: 100, total_anticipo: 120, diferencia: 20, estatus: 'cerrada', diferencias: [], viaje: { folio: 'V-1', operador: { nombre: 'Juan' } } }];
    const r = await GET_LIQ();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('liquidaciones_likida.csv');
    expect(filtros).toEqual(expect.arrayContaining([['tenant_id', 't-1']]));
    expect(await r.text()).toContain('V-1');
  });
});

describe('export/facturas-proveedor — el tenant viaja al generador y el formato se valida', () => {
  it('exporta con el tenant de la sesión y el formato pedido', async () => {
    const r = await GET_PROV('sap_b1');
    expect(r.status).toBe(200);
    expect(exportarAprobadas).toHaveBeenCalledWith('t-1', 'sap_b1');
    expect(r.headers.get('content-disposition')).toContain('facturas_proveedor_sap_b1_likida.csv');
  });

  it('un formato inventado es 400, no un default silencioso', async () => {
    const r = await GET_PROV('xml_raro');
    expect(r.status).toBe(400);
    expect(exportarAprobadas).not.toHaveBeenCalled();
  });
});

describe('export/bitacora-peaje — el desglose se busca acotado al tenant', () => {
  it('pasa el tenant de la sesión junto al id de la URL', async () => {
    const r = await GET_BIT('d-9');
    expect(r.status).toBe(200);
    expect(bitacoraRmf918).toHaveBeenCalledWith('t-1', 'd-9');
  });

  it('un desglose de otra flota (null) es 404', async () => {
    bitacoraRmf918.mockResolvedValueOnce(null);
    expect((await GET_BIT('ajeno')).status).toBe(404);
  });

  it('sin ?desglose= es 400', async () => {
    expect((await GET_BIT('')).status).toBe(400);
  });
});
