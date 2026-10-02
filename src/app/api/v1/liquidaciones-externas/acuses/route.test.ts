import { describe, it, expect, vi, beforeEach } from 'vitest';

// Salida hacia el SAP/TMS por pull: los acuses de los choferes, la confirmación y
// el archivo configurable. Se fija la PUERTA (áreas), el tenant (sale de la
// credencial, nunca de la URL ni del cuerpo), la idempotencia de la confirmación y
// que la exportación falla en vez de entregar un archivo parcial.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:dinero' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...(await orig<Record<string, unknown>>()), abrir: (...a: [Request, string]) => abrir(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

import type { LiquidacionExterna } from '@/lib/likida/liquidacion_externa/repo';
const fila = (p: Partial<LiquidacionExterna> = {}): LiquidacionExterna => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: 't-1', claveExterna: 'SAP-1', huella: 'x'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Juan Pérez', operadorTelefono: '525512345678',
  foliosViaje: [], viajeIds: [], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07', conceptos: [], total: 100, moneda: 'MXN',
  pdfRuta: 't-1/externas/SECRETA.pdf', pdfOrigen: 'generado', estado: 'acusada', via: 'sesion', generacion: 1, intentos: 1,
  proximoIntentoEn: 'x', ultimoError: null, wamid: 'w', enviadaEn: null, acuseTipo: 'recibida', acuseEn: '2026-09-09T10:00:00.000Z',
  acuseConfirmadoEn: null, creadaEn: '2026-09-08T09:00:00.000Z', ...p,
});

const pendientes = vi.fn(async (..._a: unknown[]): Promise<{ filas: LiquidacionExterna[]; hayMas: boolean }> => ({ filas: [], hayMas: false }));
const exportar = vi.fn(async (..._a: unknown[]): Promise<{ filas: LiquidacionExterna[]; truncado: boolean }> => ({ filas: [], truncado: false }));
const confirmar = vi.fn(async (..._a: unknown[]) => ({ confirmadas: [] as string[], yaConfirmadas: [] as string[], noAplican: [] as string[] }));
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/repo')>()),
  listarAcusesPendientes: (...a: unknown[]) => pendientes(...a),
  listarParaExportacion: (...a: unknown[]) => exportar(...a),
}));
vi.mock('@/lib/likida/liquidacion_externa/servicio', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/servicio')>()),
  confirmarAcusesLeidos: (...a: unknown[]) => confirmar(...a),
}));

const { GET: GET_ACUSES } = await import('./route');
const { POST: POST_CONFIRMAR } = await import('./confirmar/route');
const { validarIds } = await import('./confirmar/validar_ids');
const { GET: GET_EXPORT } = await import('../exportacion/route');
const { TOPE_EXPORTACION } = await import('../exportacion/tope');
const { CampoInvalido } = await import('../../_escritura');

const B = 'https://app.likida.ai/api/v1/liquidaciones-externas';
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  abrir.mockReset().mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:dinero' });
  pendientes.mockClear(); exportar.mockClear(); confirmar.mockReset().mockResolvedValue({ confirmadas: [], yaConfirmadas: [], noAplican: [] });
});

describe('GET acuses', () => {
  it('abre con área `dinero` y pide SOLO el tenant de la credencial (un ?tenant= de la URL no cuenta)', async () => {
    await GET_ACUSES(new Request(`${B}/acuses?tenant=t-OTRA`));
    expect(abrir.mock.calls[0][1]).toBe('dinero');
    expect(pendientes.mock.calls[0][0]).toBe('t-1');
  });

  it('si la puerta no abre, no lee nada', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 403 }) });
    expect((await GET_ACUSES(new Request(`${B}/acuses`))).status).toBe(403);
    expect(pendientes).not.toHaveBeenCalled();
  });

  it('devuelve la forma del acuse SIN teléfono ni ruta del PDF, y un cursor si hay más', async () => {
    pendientes.mockResolvedValueOnce({ filas: [fila(), fila({ id: ID2, acuseTipo: 'no_coincide', claveExterna: 'SAP-2' })], hayMas: true });
    const r = await GET_ACUSES(new Request(`${B}/acuses?limite=2`));
    const j = await json(r);
    expect(r.status).toBe(200);
    expect(j.datos).toEqual([
      { id: ID1, claveExterna: 'SAP-1', sistemaOrigen: 'SAP', operador: { id: 'o-1', nombre: 'Juan Pérez' }, respuestaChofer: 'recibida', respuestaEn: '2026-09-09T10:00:00.000Z', total: 100, moneda: 'MXN' },
      expect.objectContaining({ id: ID2, respuestaChofer: 'no_coincide' }),
    ]);
    expect(JSON.stringify(j)).not.toMatch(/525512345678|SECRETA/);
    expect(typeof j.pagina.siguiente).toBe('string');
  });

  it('`desplazamiento` es 400 (solo cursor) y un cursor roto también', async () => {
    expect((await GET_ACUSES(new Request(`${B}/acuses?desplazamiento=5`))).status).toBe(400);
    expect((await GET_ACUSES(new Request(`${B}/acuses?despues=roto`))).status).toBe(400);
    expect(pendientes).not.toHaveBeenCalled();
  });

  it('el cursor devuelto se acepta y llega al repo como (acuseEn, id)', async () => {
    pendientes.mockResolvedValueOnce({ filas: [fila()], hayMas: true });
    const j = await json(await GET_ACUSES(new Request(`${B}/acuses?limite=1`)));
    await GET_ACUSES(new Request(`${B}/acuses?limite=1&despues=${j.pagina.siguiente}`));
    expect(pendientes.mock.calls[1][2]).toEqual({ acuseEn: '2026-09-09T10:00:00.000Z', id: ID1 });
  });

  it('un fallo de lectura es error_interno SIN el mensaje de la base', async () => {
    pendientes.mockRejectedValueOnce(new Error('relation "liquidacion_externa" does not exist'));
    const r = await GET_ACUSES(new Request(`${B}/acuses`));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await json(r))).not.toMatch(/relation/);
  });
});

describe('POST acuses/confirmar', () => {
  const post = (cuerpo: unknown) => POST_CONFIRMAR(new Request(`${B}/acuses/confirmar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }));

  it('abre con área `administracion` y confirma con el tenant de la credencial', async () => {
    confirmar.mockResolvedValueOnce({ confirmadas: [ID1], yaConfirmadas: [], noAplican: [ID2] });
    const r = await post({ ids: [ID1, ID2] });
    expect(abrir.mock.calls[0][1]).toBe('administracion');
    expect(confirmar).toHaveBeenCalledWith('t-1', [ID1, ID2], 'api');
    expect(await json(r)).toEqual({ datos: { confirmadas: [ID1], yaConfirmadas: [], noAplican: [ID2] } });
  });

  it('el reintento es inocuo: lo ya confirmado se reporta como tal', async () => {
    confirmar.mockResolvedValueOnce({ confirmadas: [], yaConfirmadas: [ID1], noAplican: [] });
    expect((await json(await post({ ids: [ID1] }))).datos.yaConfirmadas).toEqual([ID1]);
  });

  it('cuerpos inválidos son 400 y no tocan la base', async () => {
    for (const c of ['{roto', '[]', 'null', { ids: [] }, { ids: 'x' }, { ids: ['no-uuid'] }, { ids: [ID1], tenant_id: 't-OTRA' }, { otro: 1 }, { ids: Array.from({ length: 201 }, () => ID1) }]) {
      expect((await post(c)).status, JSON.stringify(c).slice(0, 40)).toBe(400);
    }
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('normaliza uuid a minúsculas y valida con CampoInvalido', () => {
    expect(validarIds({ ids: [ID1.toUpperCase()] })).toEqual([ID1]);
    expect(() => validarIds({ ids: [1] })).toThrow(CampoInvalido);
  });

  it('si la puerta no abre, no confirma nada', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 401 }) });
    expect((await post({ ids: [ID1] })).status).toBe(401);
    expect(confirmar).not.toHaveBeenCalled();
  });
});

describe('GET exportacion', () => {
  it('abre con `dinero`, entrega el archivo con la configuración pedida y declara cuántas filas', async () => {
    exportar.mockResolvedValueOnce({ filas: [fila(), fila({ id: ID2, claveExterna: 'SAP-2' })], truncado: false });
    const r = await GET_EXPORT(new Request(`${B}/exportacion?columnas=claveExterna,total&separador=punto_y_coma&decimal=coma`));
    expect(abrir.mock.calls[0][1]).toBe('dinero');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    expect(r.headers.get('x-likida-filas')).toBe('2');
    expect(await r.text()).toBe('claveExterna;total\nSAP-1;100,00\nSAP-2;100,00\n');
    expect(exportar.mock.calls[0][0]).toBe('t-1');
  });

  it('tab → TSV', async () => {
    const r = await GET_EXPORT(new Request(`${B}/exportacion?separador=tab`));
    expect(r.headers.get('content-type')).toMatch(/tab-separated/);
    expect(r.headers.get('content-disposition')).toMatch(/\.tsv/);
  });

  it('un filtro con más del tope NO entrega un archivo parcial: lectura_incompleta', async () => {
    exportar.mockResolvedValueOnce({ filas: [], truncado: true });
    const r = await GET_EXPORT(new Request(`${B}/exportacion`));
    expect(r.status).toBe(500);
    expect((await json(r)).error.codigo).toBe('lectura_incompleta');
    expect(exportar.mock.calls[0][2]).toBe(TOPE_EXPORTACION);
  });

  it('pasa los filtros al repo y rechaza los inválidos', async () => {
    await GET_EXPORT(new Request(`${B}/exportacion?estado=acusada&respuestaChofer=no_coincide&desde=2026-09-01&hasta=2026-09-30&sinConfirmar=1`));
    expect(exportar.mock.calls[0][1]).toEqual({ estado: 'acusada', acuseTipo: 'no_coincide', desde: '2026-09-01', hasta: '2026-09-30', sinConfirmar: true });
    exportar.mockClear();
    for (const s of ['estado=x', 'respuestaChofer=x', 'operadorId=1', 'desde=2026-13-45', 'desde=2026-09-10&hasta=2026-09-01', 'sinConfirmar=2', 'columnas=inventada', 'decimal=coma', 'claveExterna=' + 'x'.repeat(121)]) {
      expect((await GET_EXPORT(new Request(`${B}/exportacion?${s}`))).status, s).toBe(400);
    }
    expect(exportar).not.toHaveBeenCalled();
  });

  it('si la puerta no abre, no lee', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 403 }) });
    expect((await GET_EXPORT(new Request(`${B}/exportacion`))).status).toBe(403);
    expect(exportar).not.toHaveBeenCalled();
  });
});
