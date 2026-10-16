import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// «Casetas ligadas a viaje»: misma puerta que los demás export de dinero (sesión → flota → área dinero →
// puedeExportar), desglose siempre acotado al tenant de la sesión, sin archivo corto.

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => permitido, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const leer = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@/lib/likida/peajes/vinculos_reporte', () => ({ leerVinculosParaArchivo: (...a: unknown[]) => leer(...a) }));
const { LecturaIncompleta } = await import('@/lib/likida/pg');
const { GET } = await import('./route');

const datos = {
  lineas: [
    { id: 'l1', fecha: '2026-08-05', hora: '11:30:00', unidad: 'C2-09', caseta: 'Caseta Ejemplo Sur', clase: 3, importe: 100 },
    { id: 'l2', fecha: '2026-08-05', hora: '12:00:00', unidad: 'C2-10', caseta: 'Caseta Ejemplo Norte', clase: 5, importe: 200 },
    { id: 'l3', fecha: '2026-08-06', hora: null, unidad: 'C2-11', caseta: 'Caseta Ejemplo Este', clase: null, importe: 50 },
  ],
  vinculos: [
    { lineaId: 'l1', estado: 'ligado', viajeId: 'v1', via: 'unidad_ventana', candidatos: [], motivo: null },
    { lineaId: 'l2', estado: 'sin_viaje', viajeId: null, via: 'unidad_ventana', candidatos: [], motivo: null },
    { lineaId: 'l3', estado: 'ambiguo', viajeId: null, via: 'unidad_ventana', candidatos: ['v1', 'v2'], motivo: null },
  ],
  folios: new Map([['v1', 'VJ-0001'], ['v2', 'VJ-0002']]),
};
const get = (qs = '?desglose=d1') => GET(new Request(`https://app.likida.ai/api/export/peajes-vinculos${qs}`));

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' }; permitido = true;
  leer.mockReset(); leer.mockResolvedValue(datos);
});

describe('la puerta', () => {
  it('sin sesión (401) no lee nada', async () => {
    tenant = { ok: false, status: 401, motivo: 'no' };
    expect((await get()).status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });
  it('el encargado (sin área dinero) y un rol que no exporta: 403 sin leer', async () => {
    for (const rol of ['encargado', 'operador']) {
      tenant = { ok: true, tenantId: 't-1', rol };
      expect((await get()).status, rol).toBe(403);
    }
    expect(leer).not.toHaveBeenCalled();
  });
  it('rate limit → 429', async () => {
    permitido = false;
    expect((await get()).status).toBe(429);
  });
  it('falta ?desglose → 400', async () => {
    expect((await get('')).status).toBe(400);
  });
});

describe('el archivo', () => {
  it('xlsx con las tres hojas y la lectura acotada al tenant de la sesión', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/spreadsheetml/);
    expect(r.headers.get('Content-Disposition')).toContain('peajes_vinculos_likida.xlsx');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(leer).toHaveBeenCalledWith('t-1', 'd1');
    const l = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
    expect(l.SheetNames).toEqual(['Ligadas', 'Sin viaje', 'Ambiguas']);
    expect(XLSX.utils.sheet_to_json(l.Sheets['Ligadas'])).toHaveLength(1);
  });
  it('T-A2-23: el costo por viaje que trae la lectura llega a la hoja «Ligadas»', async () => {
    leer.mockResolvedValue({ ...datos, costos: new Map([['v1', {
      viajeId: 'v1', folio: 'VJ-0001', cruces: 1, costo: 100, casetasDistintas: 1, candidatos: null, ambiguos: 1,
      aviso: null, referencia: null, fuente: 'suma del importe de 1 cruces ligados del archivo del proveedor',
    }]]) });
    const r = await get();
    const l = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
    const fila = XLSX.utils.sheet_to_json<Record<string, unknown>>(l.Sheets['Ligadas'])[0];
    expect(fila['Costo del viaje']).toBe(100);
    expect(String(fila['Costo del viaje: detalle y fuente'])).toContain('Fuente: suma del importe de 1 cruces');
  });
  it('el desglose de OTRA flota (la lectura devuelve null) es 404', async () => {
    leer.mockResolvedValue(null);
    expect((await get('?desglose=ajeno')).status).toBe(404);
    expect(leer).toHaveBeenCalledWith('t-1', 'ajeno');
  });
  it('desglose sin vínculos calculados (flag apagado o aún sin conciliar) → 409 con el motivo, no un archivo vacío engañoso', async () => {
    leer.mockResolvedValue({ ...datos, vinculos: [] });
    const r = await get();
    expect(r.status).toBe(409);
    expect(await r.text()).toMatch(/vínculo/i);
  });
  it('una lectura incompleta no sale como archivo corto (500)', async () => {
    leer.mockRejectedValue(new LecturaIncompleta('x', 10, 20));
    expect((await get()).status).toBe(500);
  });
});
