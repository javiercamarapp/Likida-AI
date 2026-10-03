import { describe, it, expect, vi, beforeEach } from 'vitest';

// La puerta de todo export de dinero: sesión → flota → área `dinero` →
// `puedeExportar`; el desglose se busca CON el tenant de la sesión (uno ajeno
// es 404); una lectura incompleta no sale como archivo corto.

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => permitido, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const leer = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@/lib/likida/peajes/bitacora_conciliada', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/peajes/bitacora_conciliada')>()),
  bitacoraConciliada: (...a: unknown[]) => leer(...a),
}));
const { LecturaIncompleta } = await import('@/lib/likida/pg');
const { LEYENDAS_BITACORA_CONCILIADA } = await import('@/lib/likida/peajes/bitacora_conciliada');
const { GET } = await import('./route');

const bitacora = {
  desgloseId: 'd1', proveedor: 'PASE', periodoDesde: '2026-08-05', periodoHasta: '2026-08-07', sinEvaluarGps: 0,
  leyendas: LEYENDAS_BITACORA_CONCILIADA,
  resumen: { total: 1, cuadra: 1, sinRespaldo: 0, porVerificar: 0, montoCuadra: 189, montoSinRespaldo: 0, montoPorVerificar: 0 },
  filas: [{
    indice: 0, fecha: '2026-08-05', hora: '10:30:00', casetaProveedor: 'Caseta Ejemplo Norte', casetaCatalogo: '', tag: 'IMDM10000001', unidad: 'C2-08', monto: 189,
    estado: 'cuadra', motivo: 'gasto', explicacion: 'Respaldado.', viaje: 'V1', diferencia: 0, gps: 'sin datos', gpsDistanciaM: null, gpsNota: 'x',
  }],
};
const get = (qs = '?desglose=d1') => GET(new Request(`https://app.likida.ai/api/export/bitacora-conciliada${qs}`));

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' }; permitido = true;
  leer.mockReset(); leer.mockResolvedValue(bitacora);
});

describe('la puerta', () => {
  it('sin sesión → el status de la credencial y no se lee nada', async () => {
    tenant = { ok: false, status: 401, motivo: 'no' };
    expect((await get()).status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });
  it('el ENCARGADO (sin área dinero) → 403', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'encargado' };
    expect((await get()).status).toBe(403);
    expect(leer).not.toHaveBeenCalled();
  });
  it('un rol que no exporta → 403', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'operador' };
    expect((await get()).status).toBe(403);
  });
  it('el dueño y el contador sí', async () => {
    for (const rol of ['flota_admin', 'contador']) {
      tenant = { ok: true, tenantId: 't-1', rol };
      expect((await get()).status, rol).toBe(200);
    }
  });
  it('rate limit → 429', async () => {
    permitido = false;
    expect((await get()).status).toBe(429);
    expect(leer).not.toHaveBeenCalled();
  });
});

describe('el archivo', () => {
  it('CSV con BOM (Excel), nombre de descarga, sin caché, y la leyenda DENTRO', async () => {
    const r = await get();
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    expect(r.headers.get('content-disposition')).toContain('bitacora_conciliada_peajes_likida.csv');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8: Excel respeta los acentos
    const t = await r.text();
    expect(t).toMatch(/# Bitácora conciliada/);
    expect(t).toContain('cuadra');
  });
  it('se consulta con el tenant de la SESIÓN, no con uno del query', async () => {
    await get('?desglose=d1&tenant=t-ajeno');
    expect(leer).toHaveBeenCalledWith('t-1', 'd1');
  });
  it('falta el desglose → 400; desglose ajeno o inexistente → 404', async () => {
    expect((await get('')).status).toBe(400);
    leer.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });
  it('lectura incompleta → 500 que NO manda un archivo corto', async () => {
    leer.mockRejectedValue(new LecturaIncompleta('x', 1000, 2500));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).toMatch(/No se manda un archivo corto/);
  });
  it('un error cualquiera → 500 genérico, sin filtrar el mensaje interno', async () => {
    leer.mockRejectedValue(new Error('relation "secreta" does not exist'));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('secreta');
  });
});
