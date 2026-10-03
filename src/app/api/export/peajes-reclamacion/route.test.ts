import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// La puerta de todo export de dinero: sesión → flota → área `dinero` → `puedeExportar`;
// el desglose se busca CON el tenant de la sesión (uno ajeno es 404); una lectura
// incompleta no sale como archivo corto; xlsx por omisión y pdf si se pide.

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => permitido, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/liquidacion_externa/repo', () => ({ leerRazonSocial: async () => 'Flota Ejemplo SA' }));

const leer = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@/lib/likida/peajes/bitacora_conciliada', () => ({ reporteReclamacion: (...a: unknown[]) => leer(...a) }));
const { LecturaIncompleta } = await import('@/lib/likida/pg');
const { LEYENDAS_RECLAMACION } = await import('@/lib/likida/peajes/reclamacion');
const { GET } = await import('./route');

const reporte = {
  desgloseId: 'd1', proveedor: 'PASE', periodoDesde: '2026-08-05', periodoHasta: '2026-08-07', leyendas: LEYENDAS_RECLAMACION,
  resumen: {
    lineas: 3, reclamables: 1, montoReclamable: 100, confirmadas: 1, sinDatos: 1, sinEvaluar: 0, sinCurso: 0,
    porMotivo: { gps_lejos_de_caseta: { n: 1, monto: 100 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, fuera_de_curso: { n: 0, monto: 0 }, doble_cobro: { n: 0, monto: 0 } },
  },
  cruces: [{
    indice: 1, fecha: '2026-08-05', hora: '11:30:00', caseta: 'Caseta Ejemplo Sur', casetaCatalogo: 'Caseta Ejemplo Sur', tag: 'IMDM10000002', unidad: 'C2-09', monto: 100,
    motivo: 'gps_lejos_de_caseta', confianza: 'alta', porQue: 'La unidad C2-09 no estaba en la caseta.', distanciaM: 22000, radioCasetaM: 300,
    evidencia: [{ en: '2026-08-05T17:28:00.000Z', lat: 19.2, lng: -99, minutosDelPase: -2, distanciaCasetaM: 22000 }], zona: null, duplicadoDeLinea: null, cursos: [],
  }],
};
const get = (qs = '?desglose=d1') => GET(new Request(`https://app.likida.ai/api/export/peajes-reclamacion${qs}`));

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' }; permitido = true;
  leer.mockReset(); leer.mockResolvedValue(reporte);
});

describe('la puerta', () => {
  it('sin sesión → el status de la credencial y no se lee nada', async () => {
    tenant = { ok: false, status: 401, motivo: 'no' };
    expect((await get()).status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });
  it('el ENCARGADO (sin área dinero) → 403 sin leer', async () => {
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
  });
});

describe('el archivo', () => {
  it('Excel por omisión, con el tenant de la sesión y el desglose pedido; sin caché', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/spreadsheetml/);
    expect(r.headers.get('Content-Disposition')).toContain('reclamacion_peajes_likida.xlsx');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(leer).toHaveBeenCalledWith('t-1', 'd1');
    const libro = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
    const m = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Reclamación'], { header: 1, defval: null });
    expect(m.find((f) => f[0] === 'Total reclamable')?.[7]).toBe(100);
  });

  it('PDF si se pide', async () => {
    const r = await get('?desglose=d1&formato=pdf');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('un formato desconocido es 400 y falta de desglose es 400 (no llegan a la base)', async () => {
    expect((await get('?desglose=d1&formato=docx')).status).toBe(400);
    expect((await get('')).status).toBe(400);
    expect(leer).not.toHaveBeenCalled();
  });

  it('un desglose de otra flota o inexistente es 404, nunca datos ajenos', async () => {
    leer.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
  });

  it('una lectura incompleta NO sale como archivo corto', async () => {
    leer.mockRejectedValueOnce(new LecturaIncompleta('x', 1, 5));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).toMatch(/No se manda un archivo corto/);
  });

  it('otro fallo: 500 de texto fijo, sin filtrar el error', async () => {
    leer.mockRejectedValueOnce(new Error('relation does not exist'));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).not.toMatch(/relation/);
  });
});
