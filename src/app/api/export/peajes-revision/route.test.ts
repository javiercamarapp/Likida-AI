import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// La puerta de todo export de dinero (sesión → flota → área `dinero` → `puedeExportar`), el
// desglose acotado al tenant de la sesión, una lectura incompleta que no sale como archivo corto,
// y el contenido: candidatos con su explicación y el rótulo «validar con el proveedor».

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => permitido, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const leer = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@/lib/likida/peajes/revision_cobros', () => ({ revisionDeDesglose: (...a: unknown[]) => leer(...a) }));
const { LecturaIncompleta } = await import('@/lib/likida/pg');
const { revisarCobros } = await import('@/lib/likida/peajes/reglas_cobro');
const { detectarAtipicos } = await import('@/lib/likida/peajes/cruces_atipicos');
const { GET } = await import('./route');

const lineas = [
  { indice: 0, fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', unidad: '101', clase: 9, monto: 400 },
  { indice: 1, fecha: '2026-02-27', hora: '11:00:00', caseta: '=HYPERLINK("http://x")', tag: 'IMDM00000002', unidad: 'TC2001', clase: 5, monto: 250 },
];
const reporte = {
  desgloseId: 'd1', proveedor: 'IAVE', archivoNombre: '01 A 10 DE MARZO.xlsx', periodoMedidoDesde: '2026-02-27', periodoMedidoHasta: '2026-03-05',
  periodoOficialDesde: '2026-03-01', periodoOficialHasta: '2026-03-10', periodoOrigen: 'nombre_archivo', noPeriodo: '801',
  calidad: { filasLeidas: 2, lineasImportadas: 2, hojaLeida: 'g00', hojasIgnoradas: ['Hoja1'], sinEncabezadoConDatos: ['O'], noReconocidas: [], columnasFaltantes: [], columnas: [{ letra: 'A', encabezado: 'Clase', campo: 'clase', conDatos: true }] },
  revision: revisarCobros(lineas, { periodoDesde: '2026-03-01' }),
  atipicos: detectarAtipicos(lineas),
  rotulo: 'Candidato: validar con el proveedor',
};
const get = (qs = '?desglose=d1') => GET(new Request(`https://app.likida.ai/api/export/peajes-revision${qs}`));

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
  it('el ENCARGADO (sin área dinero) y un rol que no exporta → 403 sin leer', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'encargado' };
    expect((await get()).status).toBe(403);
    tenant = { ok: true, tenantId: 't-1', rol: 'operador' };
    expect((await get()).status).toBe(403);
    expect(leer).not.toHaveBeenCalled();
  });
  it('rate limit → 429; sin ?desglose → 400', async () => {
    permitido = false;
    expect((await get()).status).toBe(429);
    permitido = true;
    expect((await get('')).status).toBe(400);
  });
  it('desglose ajeno o anulado → 404, y se busca con el tenant de la sesión', async () => {
    leer.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(leer).toHaveBeenCalledWith('t-1', 'd1');
  });
  it('lectura incompleta → 500 y no un archivo corto', async () => {
    leer.mockRejectedValue(new LecturaIncompleta('x', 10, 20));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).toMatch(/no se manda un archivo corto/i);
  });
});

describe('el archivo', () => {
  it('Excel con candidatos explicados, rótulo y calidad; los textos del proveedor NO son fórmula', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Content-Type')).toMatch(/spreadsheetml/);
    const libro = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
    expect(libro.SheetNames).toEqual(['Resumen', 'Candidatos', 'Calidad del archivo', 'Atípicos']);

    const cand = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets.Candidatos, { range: 2 });
    expect(cand.map((c) => c['Categoría']).sort()).toEqual(['Clase distinta de 3 y 5', 'Cobro extemporáneo']);
    for (const c of cand) {
      expect(String(c['Qué pasó']).length).toBeGreaterThan(20);
      expect(String(c['Qué significa']).length).toBeGreaterThan(20);
      expect(String(c['Qué hacer']).length).toBeGreaterThan(20);
      expect(c['Estado']).toBe('Candidato: validar con el proveedor');
    }
    // la caseta "=HYPERLINK(...)" quedó como texto con apóstrofo, no como fórmula
    const ext = cand.find((c) => c['Categoría'] === 'Cobro extemporáneo')!;
    expect(String(ext['Caseta'])).toBe(`'=HYPERLINK("http://x")`);
    expect(Object.values(libro.Sheets.Candidatos).some((c) => (c as XLSX.CellObject).f)).toBe(false);

    const resumen = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets.Resumen, { header: 1 }).flat().join('|');
    expect(resumen).toMatch(/Candidato: validar con el proveedor/);
    expect(resumen).toMatch(/Periodo del archivo: 2026-03-01 a 2026-03-10/);
    const cal = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Calidad del archivo'], { header: 1 }).flat().join('|');
    expect(cal).toMatch(/Hoja1/);
  });
});
