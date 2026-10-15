import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// La puerta de todo export de dinero (sesión → flota → área `dinero` → `puedeExportar`), el desglose
// acotado al tenant de la sesión, una lectura incompleta que no sale como archivo corto, y el contenido:
// una hoja por categoría, tarifa confirmada vs inferida, exclusión de lo ya reclamado, CSV equivalente.

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => permitido, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LecturaIncompleta } = await import('@/lib/likida/pg');
const { revisarCobros } = await import('@/lib/likida/peajes/reglas_cobro');

const lineas = [
  { indice: 0, fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', unidad: '101', clase: 9, monto: 400 },
  { indice: 1, fecha: '2026-02-27', hora: '11:00:00', caseta: '=HYPERLINK("http://x")', tag: 'IMDM00000002', unidad: 'TC2001', clase: 5, monto: 250 },
  { indice: 2, fecha: '2026-03-06', hora: '12:00:00', caseta: 'Caseta Ejemplo Sur', tag: 'IMDM00000003', unidad: '103', clase: 5, monto: 130 },
];
const filasBase = lineas.map((x) => ({ indice: x.indice, fecha: x.fecha, hora: x.hora, caseta: x.caseta, tag: x.tag, monto: x.monto, clase: x.clase, unidad_archivo: x.unidad }));
const reporte = {
  desgloseId: 'd1', proveedor: 'Proveedor Ejemplo', archivoNombre: '01 A 10 DE MARZO.xlsx',
  periodoOficialDesde: '2026-03-01', periodoOficialHasta: '2026-03-10',
  revision: revisarCobros(lineas, { periodoDesde: '2026-03-01' }),
};

const revision = vi.fn(async (..._a: unknown[]): Promise<unknown> => reporte);
const lineasDe = vi.fn(async (..._a: unknown[]): Promise<unknown> => filasBase);
const reclamos = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ reclamos: [], resumen: {} }));
const tarifasDe = vi.fn(async (..._a: unknown[]): Promise<unknown> => [
  { casetaNorm: 'caseta ejemplo sur', clase: 5, importe: 100, vigenteDesde: '2026-01-01', vigenteHasta: null, origen: 'proveedor', confirmada: true, confirmadaPor: 'f' },
]);
vi.mock('@/lib/likida/peajes/revision_cobros', () => {
  return {
    revisionDeDesglose: (...a: unknown[]) => revision(...a),
    lineasDeDesglose: (...a: unknown[]) => lineasDe(...a),
    listarReglasCasetas: async () => [],
    listarReclamos: (...a: unknown[]) => reclamos(...a),
    lineaCobroDeFila: (f: Record<string, unknown>) => ({
      indice: Number(f.indice), fecha: f.fecha ?? null, hora: f.hora ?? null, caseta: f.caseta ?? null, tag: f.tag ?? null,
      unidad: f.unidad_archivo ?? null, clase: f.clase ?? null, monto: Number(f.monto),
    }),
  };
});
vi.mock('@/lib/likida/peajes/datos', () => ({ listarTarifas: (...a: unknown[]) => tarifasDe(...a) }));

const { GET } = await import('./route');
const get = (qs = '?desglose=d1') => GET(new Request(`https://app.likida.ai/api/export/peajes-candidatos${qs}`));
const libroDe = async (r: Response) => XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' }; permitido = true;
  revision.mockReset(); revision.mockResolvedValue(reporte);
  lineasDe.mockReset(); lineasDe.mockResolvedValue(filasBase);
  reclamos.mockReset(); reclamos.mockResolvedValue({ reclamos: [], resumen: {} });
});

describe('la puerta', () => {
  it('sin sesión → el status de la credencial y no se lee nada', async () => {
    tenant = { ok: false, status: 401, motivo: 'no' };
    expect((await get()).status).toBe(401);
    expect(revision).not.toHaveBeenCalled();
  });
  it('el ENCARGADO (sin área dinero) y un rol que no exporta → 403 sin leer', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'encargado' };
    expect((await get()).status).toBe(403);
    tenant = { ok: true, tenantId: 't-1', rol: 'operador' };
    expect((await get()).status).toBe(403);
    expect(revision).not.toHaveBeenCalled();
  });
  it('rate limit → 429; sin ?desglose → 400; formato desconocido → 400', async () => {
    permitido = false;
    expect((await get()).status).toBe(429);
    permitido = true;
    expect((await get('')).status).toBe(400);
    expect((await get('?desglose=d1&formato=pdf')).status).toBe(400);
  });
  it('desglose ajeno o anulado (otra flota) → 404, buscado con el tenant de la sesión y sin leer líneas ni tarifas', async () => {
    revision.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(revision).toHaveBeenCalledWith('t-1', 'd1');
    expect(lineasDe).not.toHaveBeenCalled();
    expect(tarifasDe).not.toHaveBeenCalled();
  });
  it('lectura incompleta → 500 y no un archivo corto', async () => {
    lineasDe.mockRejectedValue(new LecturaIncompleta('x', 10, 20));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).toMatch(/no se manda un archivo corto/i);
  });
  it('las lecturas se piden con el tenant de la sesión, nunca con uno del cliente', async () => {
    await get('?desglose=d1&tenant=t-ajeno');
    expect(lineasDe).toHaveBeenCalledWith('t-1', 'd1');
    expect(tarifasDe).toHaveBeenCalledWith('t-1');
  });
});

describe('el archivo', () => {
  it('Excel: una hoja por categoría con candidatos, tarifa confirmada como «Indebido confirmado», textos del proveedor sin fórmula', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Content-Type')).toMatch(/spreadsheetml/);
    const libro = await libroDe(r);
    expect(libro.SheetNames).toEqual(['Clase distinta de 3 y 5', 'Cobro extemporáneo', 'Importe mayor que la tarifa', 'Resumen', 'Léeme']);

    const sobre = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Importe mayor que la tarifa']);
    expect(sobre).toHaveLength(1);
    expect(sobre[0]).toMatchObject({ Importe: 130, 'Importe esperado': 100, 'Monto a reclamar': 30, Estado: 'Indebido confirmado' });

    const ext = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Cobro extemporáneo']);
    expect(ext[0].Caseta).toBe(`'=HYPERLINK("http://x")`);
    expect(ext[0].Estado).toBe('Candidato');
    for (const n of libro.SheetNames) expect(Object.values(libro.Sheets[n]).some((c) => (c as XLSX.CellObject).f)).toBe(false);
  });

  it('sin tarifa confirmada la diferencia sigue siendo «Candidato»', async () => {
    tarifasDe.mockResolvedValueOnce([
      { casetaNorm: 'caseta ejemplo sur', clase: 5, importe: 100, vigenteDesde: '2026-01-01', vigenteHasta: null, origen: 'declarada', confirmada: false, confirmadaPor: null },
    ]);
    const libro = await libroDe(await get());
    const sobre = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Importe mayor que la tarifa']);
    expect(sobre[0]).toMatchObject({ 'Monto a reclamar': 30, Estado: 'Candidato' });

    // y sin ninguna tarifa (ni suficientes cruces para inferir) la hoja de importe no existe
    tarifasDe.mockResolvedValueOnce([]);
    expect((await libroDe(await get())).SheetNames).not.toContain('Importe mayor que la tarifa');
  });

  it('CSV equivalente, con BOM y la categoría al inicio de cada renglón', async () => {
    const r = await get('?desglose=d1&formato=csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/text\/csv/);
    const bytes = Buffer.from(await r.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const t = bytes.toString('utf8').slice(1);
    const filas = t.trim().split('\r\n');
    expect(filas).toHaveLength(1 + 3);
    expect(filas.slice(1).map((f) => f.split(',')[0]).sort()).toEqual(['Clase distinta de 3 y 5', 'Cobro extemporáneo', 'Importe mayor que la tarifa']);
  });

  it('excluirReclamados=1 quita la categoría que ya tiene reclamo no rechazado de ESTE desglose; uno rechazado o de otro desglose no la quita', async () => {
    reclamos.mockResolvedValue({
      reclamos: [
        { desgloseId: 'd1', estado: 'enviado', categoria: 'extemporaneo' },
        { desgloseId: 'd1', estado: 'rechazado', categoria: 'clase_fuera_de_3_5' },
        { desgloseId: 'otro', estado: 'enviado', categoria: 'clase_fuera_de_3_5' },
      ],
      resumen: {},
    });
    const libro = await libroDe(await get('?desglose=d1&excluirReclamados=1'));
    expect(libro.SheetNames).toEqual(['Clase distinta de 3 y 5', 'Importe mayor que la tarifa', 'Resumen', 'Léeme']);
    // sin la opción, el reclamo existente no cambia nada
    expect((await libroDe(await get())).SheetNames).toContain('Cobro extemporáneo');
  });

  it('sin candidatos: libro con la hoja «Sin candidatos» y el mensaje', async () => {
    revision.mockResolvedValue({ ...reporte, revision: revisarCobros([], {}) });
    lineasDe.mockResolvedValue([]);
    const libro = await libroDe(await get());
    expect(libro.SheetNames).toEqual(['Sin candidatos', 'Resumen', 'Léeme']);
  });
});
