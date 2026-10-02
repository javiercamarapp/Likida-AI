import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DE LIQUIDACIONES EXTERNAS — la puerta de todo export de dinero:
// sesión → flota → área `dinero` → `puedeExportar`; el PDF se busca CON el
// tenant de la sesión (un id ajeno es 404); el CSV recorre por cursor y
// DEMUESTRA que trajo todo (count exacto contra lo leído), o no sale.
// ═══════════════════════════════════════════════════════════════════════════

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => permitido, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { LiquidacionExterna } from '@/lib/likida/liquidacion_externa/repo';
const fila = (i: number, p: Partial<LiquidacionExterna> = {}): LiquidacionExterna => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tenantId: 't-1', claveExterna: `SAP-${i}`, huella: 'h'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Juan Pérez', operadorTelefono: '525512345678',
  foliosViaje: ['V1'], viajeIds: [], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07', conceptos: [], total: 100,
  moneda: 'MXN', pdfRuta: 't-1/externas/x.pdf', pdfOrigen: 'generado', estado: 'enviada', via: 'sesion', generacion: 1, intentos: 1,
  proximoIntentoEn: 'x', ultimoError: null, wamid: 'w', enviadaEn: '2026-09-08T10:00:00Z', acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null,
  creadaEn: `2026-09-08T09:${String(59 - (i % 60)).padStart(2, '0')}:00.000Z`, ...p,
});

let todas: LiquidacionExterna[] = [];
let totalDeclarado: number | null = null;
const listar = vi.fn(async (_t: string, _f: unknown, limite: number, despues: { creadoEn: string; id: string } | null, conConteo: boolean) => {
  let universo = todas;
  if (despues) universo = todas.slice(todas.findIndex((x) => x.id === despues.id) + 1);
  const page = universo.slice(0, limite + 1);
  return { filas: page.slice(0, limite), hayMas: page.length > limite, total: conConteo ? (totalDeclarado ?? todas.length) : null };
});
const leer = vi.fn(async (_t: string, id: string): Promise<LiquidacionExterna | null> => todas.find((x) => x.id === id) ?? null);
const firmar = vi.fn(async (..._a: unknown[]): Promise<string> => 'https://storage/firmada');
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/repo')>()),
  listarLiquidacionesExternas: (...a: [string, unknown, number, { creadoEn: string; id: string } | null, boolean]) => listar(...a),
  leerPorId: (...a: [string, string]) => leer(...a),
  firmarPdfExterno: (...a: unknown[]) => firmar(...a),
}));

const { GET } = await import('./route');
const URL_BASE = 'https://app.likida.ai/api/export/liquidaciones-externas';
const get = (qs = '') => GET(new Request(`${URL_BASE}${qs}`));
const PERIODO = '?desde=2026-09-01&hasta=2026-09-30';

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' }; permitido = true;
  todas = [fila(1), fila(2), fila(3)]; totalDeclarado = null;
  listar.mockClear(); leer.mockClear(); firmar.mockClear();
  firmar.mockResolvedValue('https://storage/firmada');
});

describe('la puerta', () => {
  it('sin sesión → el status que diga la credencial, y no se lee nada', async () => {
    tenant = { ok: false, status: 401, motivo: 'no' };
    expect((await get(PERIODO)).status).toBe(401);
    expect(listar).not.toHaveBeenCalled();
  });

  it('el ENCARGADO (área `operacion`, sin dinero) → 403: este archivo es dinero', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'encargado' };
    expect((await get(PERIODO)).status).toBe(403);
    expect((await get('?pdf=00000000-0000-4000-8000-000000000001')).status).toBe(403);
    expect(listar).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
  });

  it('un rol que no exporta (operador) → 403', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'operador' };
    expect((await get(PERIODO)).status).toBe(403);
  });

  it('el contador y el dueño sí exportan', async () => {
    for (const rol of ['flota_admin', 'contador']) {
      tenant = { ok: true, tenantId: 't-1', rol };
      expect((await get(PERIODO)).status, rol).toBe(200);
    }
  });

  it('rate limit → 429', async () => {
    permitido = false;
    expect((await get(PERIODO)).status).toBe(429);
  });
});

describe('el CSV', () => {
  it('exige periodo (desde y hasta) y de a lo más 3 meses', async () => {
    expect((await get()).status).toBe(400);
    expect((await get('?desde=2026-09-01')).status).toBe(400);
    expect((await get('?desde=2026-01-01&hasta=2026-12-31')).status).toBe(400);
    expect((await get('?desde=2026-09-10&hasta=2026-09-01')).status).toBe(400);
    expect(listar).not.toHaveBeenCalled();
  });

  it('sale como attachment, sin caché, con su nombre de periodo y una fila por liquidación', async () => {
    const r = await get(PERIODO);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/text\/csv/);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Content-Disposition')).toContain('liquidaciones_externas_2026-09-01_a_2026-09-30.csv');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const lineas = (await r.text()).trimEnd().split('\n');
    expect(lineas).toHaveLength(4);
    expect(lineas[0].startsWith('claveExterna,')).toBe(true);
  });

  it('filtra por la FLOTA DE LA SESIÓN y por el periodo pedido', async () => {
    await get(`${PERIODO}&estado=fallida`);
    expect(listar.mock.calls[0][0]).toBe('t-1');
    expect(listar.mock.calls[0][1]).toEqual({ desde: '2026-09-01', hasta: '2026-09-30', estado: 'fallida' });
  });

  it('un estado inválido es 400', async () => {
    expect((await get(`${PERIODO}&estado=entregada`)).status).toBe(400);
  });

  it('recorre VARIAS páginas por cursor, sin repetir ni perder filas', async () => {
    todas = Array.from({ length: 1_234 }, (_, i) => fila(i + 1));
    const r = await get(PERIODO);
    expect(r.status).toBe(200);
    const lineas = (await r.text()).trimEnd().split('\n');
    expect(lineas).toHaveLength(1_235);
    expect(new Set(lineas.slice(1).map((l) => l.split(',')[0])).size).toBe(1_234);
    // 500 por página + 1 de lookahead = nunca roza el max_rows de 1,000 de PostgREST
    for (const c of listar.mock.calls) expect(c[2]).toBeLessThan(1_000);
    expect(listar.mock.calls.filter((c) => c[4]).length).toBe(1); // el conteo, solo en la primera
  });

  it('LECTURA INCOMPLETA: si el conteo dice más de lo que se leyó, NO sale un archivo corto con cara de completo', async () => {
    totalDeclarado = 5;
    const r = await get(PERIODO);
    expect(r.status).toBe(500);
    expect(r.headers.get('Content-Type')).not.toMatch(/csv/);
  });

  it('sin conteo no hay con qué demostrar: no sale', async () => {
    listar.mockResolvedValueOnce({ filas: [fila(1)], hayMas: false, total: null });
    expect((await get(PERIODO)).status).toBe(500);
  });

  it('periodo sin liquidaciones: solo el encabezado (200), no un error', async () => {
    todas = [];
    const r = await get(PERIODO);
    expect(r.status).toBe(200);
    expect((await r.text()).trimEnd().split('\n')).toHaveLength(1);
  });

  it('un error de base es 500 de texto fijo, sin el mensaje interno', async () => {
    listar.mockRejectedValueOnce(new Error('relation "liquidacion_externa" does not exist'));
    const r = await get(PERIODO);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toMatch(/relation|liquidacion_externa/);
  });

  it('un nombre hostil no se vuelve fórmula en el archivo', async () => {
    todas = [fila(1, { operadorNombre: '=HYPERLINK("http://malo","x")' })];
    const t = await (await get(PERIODO)).text();
    expect(t).toContain(`"'=HYPERLINK(""http://malo"",""x"")"`);
  });
});

describe('el PDF', () => {
  const ID = '00000000-0000-4000-8000-000000000001';

  it('redirige 302 a una URL firmada de vida corta, con nombre de descarga y sin caché', async () => {
    const r = await get(`?pdf=${ID}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://storage/firmada');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(firmar).toHaveBeenCalledWith('t-1/externas/x.pdf', 60, 'liquidacion_SAP-1.pdf');
  });

  it('busca CON el tenant de la sesión: el id de otra flota es 404, nunca el documento de otro', async () => {
    leer.mockResolvedValueOnce(null);
    expect((await get(`?pdf=${ID}`)).status).toBe(404);
    expect(leer).toHaveBeenCalledWith('t-1', ID);
    expect(firmar).not.toHaveBeenCalled();
  });

  it('un id que no es uuid es 400 (no llega a la base)', async () => {
    expect((await get('?pdf=../../etc/passwd')).status).toBe(400);
    expect(leer).not.toHaveBeenCalled();
  });

  it('una liquidación sin PDF es 404', async () => {
    todas = [fila(1, { pdfRuta: null })];
    expect((await get(`?pdf=${ID}`)).status).toBe(404);
  });

  it('si Storage no firma, 502 de texto fijo', async () => {
    firmar.mockRejectedValueOnce(new Error('bucket no existe'));
    const r = await get(`?pdf=${ID}`);
    expect(r.status).toBe(502);
    expect(await r.text()).not.toMatch(/bucket/);
  });

  it('el nombre de descarga no puede traer rutas ni saltos aunque la clave los traiga', async () => {
    todas = [fila(1, { claveExterna: 'A/../B"\n' })];
    await get(`?pdf=${ID}`);
    expect(firmar.mock.calls[0][2]).toMatch(/^liquidacion_[A-Za-z0-9._-]+\.pdf$/);
  });
});

describe('el Excel (formato de la flota, 0564)', () => {
  const ID = '00000000-0000-4000-8000-000000000001';

  it('redirige 302 a la URL firmada del .xlsx junto al PDF, con nombre de descarga', async () => {
    const r = await get(`?excel=${ID}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(firmar).toHaveBeenCalledWith('t-1/externas/x.xlsx', 60, 'liquidacion_SAP-1.xlsx');
  });

  it('busca CON el tenant de la sesión y rechaza ids que no son uuid', async () => {
    leer.mockResolvedValueOnce(null);
    expect((await get(`?excel=${ID}`)).status).toBe(404);
    expect(leer).toHaveBeenCalledWith('t-1', ID);
    expect((await get('?excel=../../x')).status).toBe(400);
  });

  it('el PDF que adjuntó el cliente no tiene Excel: 404 con su razón', async () => {
    todas = [fila(1, { pdfOrigen: 'adjunto' })];
    const r = await get(`?excel=${ID}`);
    expect(r.status).toBe(404);
    expect(firmar).not.toHaveBeenCalled();
  });

  it('llegó antes de configurar el formato (el objeto no existe): 404, no 502', async () => {
    firmar.mockRejectedValueOnce(new Error('liquidacion_externa firmar PDF: Object not found'));
    expect((await get(`?excel=${ID}`)).status).toBe(404);
  });

  it('otro fallo de Storage: 502 de texto fijo', async () => {
    firmar.mockRejectedValueOnce(new Error('bucket caído'));
    const r = await get(`?excel=${ID}`);
    expect(r.status).toBe(502);
    expect(await r.text()).not.toMatch(/bucket/);
  });

  it('sin permiso de dinero no firma nada', async () => {
    tenant = { ok: true, tenantId: 't-1', rol: 'encargado' };
    expect((await get(`?excel=${ID}`)).status).toBe(403);
    expect(firmar).not.toHaveBeenCalled();
  });
});
