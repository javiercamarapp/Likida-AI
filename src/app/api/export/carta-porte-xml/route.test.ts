import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// La ruta de export del XML de Carta Porte (Fase D) con las MISMAS anclas que
// rutas_export.test.ts fijó tras la auditoría 18 (A21): la puerta del dato
// (área operacion vía puedeVerRuta, con el módulo REAL de visibilidad), la
// del verbo (puedeExportar REAL), y la consulta acotada al tenant. Lo que se
// dobla es la base, la sesión y el lector del borrador.
// ═══════════════════════════════════════════════════════════════════════════

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => ({ userId: 'u-9' }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async (p: unknown) => p }));

// El lector del borrador y el generador: la ruta se prueba como PUERTA — el
// generador tiene su propia suite (carta_porte_xml.test.ts).
let viaje: unknown = null;
vi.mock('@/lib/likida/carta_porte_datos', () => ({ getBorradorViaje: async () => viaje }));
let resultadoXml: { ok: true; xml: string; nombreArchivo: string; idCcp: string; omitidos: string[] } | { ok: false; motivos: string[] } =
  { ok: true, xml: '<xml/>', nombreArchivo: 'carta-porte-F1.xml', idCcp: 'CCC0', omitidos: [] };
const generarXmlCcp = vi.fn((_v: unknown, _id: string) => resultadoXml);
vi.mock('@/lib/likida/carta_porte_xml', () => ({ generarXmlCcp: (v: unknown, id: string) => generarXmlCcp(v, id) }));

// La base: registra el UPDATE del sello y sus filtros; `viajeDb` es la columna `ccp_id_ccp` del viaje (A37-S10-05).
const filtros: Array<[string, unknown]> = [];
let selloError: { message: string } | null = null;
let viajeDb: { ccp_id_ccp: string | null } = { ccp_id_ccp: null };
let sinColumna = false;
const update = vi.fn();
function builder() {
  let op: 'select' | 'update' = 'select';
  let cambios: Record<string, unknown> = {};
  let soloSiNulo = false;
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    update: (v: Record<string, unknown>) => { op = 'update'; cambios = v; update(v); return b; },
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return b; },
    is: (c: string, v: unknown) => { if (c === 'ccp_id_ccp' && v === null) soloSiNulo = true; return b; },
    maybeSingle: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
      if (sinColumna && ('ccp_id_ccp' in cambios || op === 'select')) {
        return Promise.resolve({ data: null, error: { code: '42703', message: 'column viaje.ccp_id_ccp does not exist' } }).then(res, rej);
      }
      if (op === 'select') return Promise.resolve({ data: { ...viajeDb }, error: null }).then(res, rej);
      let filas: unknown[] = [{ id: 'v-1' }];
      if ('ccp_id_ccp' in cambios) {
        if (soloSiNulo && viajeDb.ccp_id_ccp !== null) filas = [];
        else viajeDb.ccp_id_ccp = cambios.ccp_id_ccp as string;
      }
      return Promise.resolve({ data: filas, error: 'ccp_xml_generado_en' in cambios ? selloError : null }).then(res, rej);
    },
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));

const { GET } = await import('./route');
const URL_OK = 'https://x/api/export/carta-porte-xml?viaje=11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' };
  viaje = { viajeId: 'v-1' };
  resultadoXml = { ok: true, xml: '<xml/>', nombreArchivo: 'carta-porte-F1.xml', idCcp: 'CCC0', omitidos: [] };
  selloError = null;
  viajeDb = { ccp_id_ccp: null }; sinColumna = false;
  generarXmlCcp.mockClear();
  filtros.length = 0;
  update.mockClear();
});

describe('GET /api/export/carta-porte-xml', () => {
  it('un operador NO baja el XML (área operacion lo permite a flota_admin/encargado, no al chofer)', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'operador' };
    expect((await GET(new Request(URL_OK))).status).toBe(403);
  });

  it('un contador NO lo baja: exporta, pero no ve el área operacion', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'contador' };
    expect((await GET(new Request(URL_OK))).status).toBe(403);
  });

  it('sin ?viaje= es 400; viaje de otra flota (lector devuelve null) es 404', async () => {
    expect((await GET(new Request('https://x/api/export/carta-porte-xml'))).status).toBe(400);
    viaje = null;
    expect((await GET(new Request(URL_OK))).status).toBe(404);
  });

  it('borrador que no genera = 409 con los motivos, sin sello', async () => {
    resultadoXml = { ok: false, motivos: ['Falta el peso.'] };
    const r = await GET(new Request(URL_OK));
    expect(r.status).toBe(409);
    expect(await r.text()).toContain('Falta el peso.');
    // Sin sello de generación (el IdCCP del viaje sí queda reservado: es el mismo cuando por fin genere).
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ ccp_xml_generado_en: expect.anything() }));
  });

  it('éxito: XML como descarga, y el sello acotado al tenant con quién y cuándo', async () => {
    const r = await GET(new Request(URL_OK));
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('application/xml');
    expect(r.headers.get('Content-Disposition')).toContain('carta-porte-F1.xml');
    // El XML es de un viaje/tenant concreto: un caché intermedio no debe
    // reutilizarlo para otra sesión.
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await r.text()).toBe('<xml/>');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ ccp_xml_generado_por: 'u-9' }));
    expect(filtros).toContainEqual(['tenant_id', 't-1']);
    expect(filtros).toContainEqual(['id', '11111111-2222-4333-8444-555555555555']);
  });

  it('el sello caído NO le niega el archivo a la flota', async () => {
    selloError = { message: 'se cayó' };
    const r = await GET(new Request(URL_OK));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('<xml/>');
  });

  describe('A37-S10-05: el IdCCP es por viaje, no por descarga', () => {
    const ID_RE = /^CCC[0-9a-f]{5}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('dos descargas del mismo viaje reciben el MISMO IdCCP, y queda guardado en el viaje', async () => {
      const a = await GET(new Request(URL_OK));
      const b = await GET(new Request(URL_OK));
      const [id1, id2] = [generarXmlCcp.mock.calls[0][1], generarXmlCcp.mock.calls[1][1]];
      expect(id1).toMatch(ID_RE);
      expect(id2).toBe(id1);
      expect(viajeDb.ccp_id_ccp).toBe(id1);
      expect(a.status).toBe(200); expect(b.status).toBe(200);
    });

    it('un viaje que ya tiene IdCCP lo conserva (no se pisa)', async () => {
      viajeDb = { ccp_id_ccp: 'CCC12345-aaaa-4bbb-8ccc-1234567890ab' };
      await GET(new Request(URL_OK));
      expect(generarXmlCcp.mock.calls[0][1]).toBe('CCC12345-aaaa-4bbb-8ccc-1234567890ab');
      expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ ccp_id_ccp: expect.anything() }));
    });

    it('?regenerar=1 es la acción explícita: cambia el IdCCP, lo guarda y lo avisa en cabecera', async () => {
      viajeDb = { ccp_id_ccp: 'CCC12345-aaaa-4bbb-8ccc-1234567890ab' };
      const r = await GET(new Request(`${URL_OK}&regenerar=1`));
      const nuevo = generarXmlCcp.mock.calls[0][1];
      expect(nuevo).not.toBe('CCC12345-aaaa-4bbb-8ccc-1234567890ab');
      expect(viajeDb.ccp_id_ccp).toBe(nuevo);
      expect(r.headers.get('X-IdCCP-Regenerado')).toBe('1');
      expect(r.headers.get('X-IdCCP')).toBe(resultadoXml.ok ? resultadoXml.idCcp : '');
    });

    it('sin la 0899 en la base: sigue funcionando como antes (un id por descarga) y no rompe', async () => {
      sinColumna = true;
      const r = await GET(new Request(URL_OK));
      expect(r.status).toBe(200);
      expect(generarXmlCcp.mock.calls[0][1]).toMatch(ID_RE);
    });
  });
});
