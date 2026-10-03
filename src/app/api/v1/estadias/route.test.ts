import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /v1/estadias, GET /v1/sitios y PUT /v1/viajes/{id}/sitios — las puertas. Lo que se fija: el ÁREA (dinero para las
// estadías, operación para el catálogo, administración para escribir), que el TENANT sale de la credencial y nada de la
// query ni del cuerpo lo cambia, que la query inválida es 400 en palabras, el CSV (BOM, encabezados, truncada) y que
// «no existe» y «no es tuyo» son lo mismo.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:dinero' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const estadiasDelPeriodo = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ filas: [], resumen: { paradas: 0 }, truncada: false }));
vi.mock('@/lib/likida/conductor/servicios', () => ({ estadiasDelPeriodo: (...a: unknown[]) => estadiasDelPeriodo(...a) }));
const listarSitios = vi.fn(async (..._a: unknown[]) => ({ sitios: [{ id: 's1', nombre: 'Planta', tipo: 'planta', codigo: 'PL', direccion: null, lat: 20.7, lng: -103.4, radioM: 300, activa: true, fuente: 'csv', clienteId: null, clienteNombre: null, padreId: null }], hayMas: false }));
const asignarSitiosViaje = vi.fn(async (..._a: unknown[]): Promise<'ok' | 'viaje_no_encontrado' | 'sitio_no_encontrado'> => 'ok');
vi.mock('@/lib/likida/conductor/repo_validacion', () => ({
  listarSitios: (...a: unknown[]) => listarSitios(...a), asignarSitiosViaje: (...a: unknown[]) => asignarSitiosViaje(...a),
}));

const estadias = await import('./route');
const sitios = await import('../sitios/route');
const sitiosViaje = await import('../viajes/[id]/sitios/route');

const BASE = 'https://app.likida.ai/api/v1';
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const U = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d009';
const put = (id: string, cuerpo: unknown) => sitiosViaje.PUT(
  new Request(`${BASE}/viajes/${id}/sitios`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:dinero' });
  estadiasDelPeriodo.mockClear(); listarSitios.mockClear(); asignarSitiosViaje.mockClear();
});

describe('GET /v1/estadias', () => {
  it('pide el área DINERO (trae el monto propuesto) y acota a la flota de la credencial aunque la query pida otra', async () => {
    const r = await estadias.GET(new Request(`${BASE}/estadias?desde=2026-10-01&hasta=2026-10-02&tenant=t-OTRA`));
    expect(r.status).toBe(200);
    expect(abrir.mock.calls[0][1]).toBe('dinero');
    expect(estadiasDelPeriodo.mock.calls[0][0]).toBe('t-1');
    expect(estadiasDelPeriodo.mock.calls[0][1]).toEqual(new Date('2026-10-01T06:00:00.000Z'));
    expect(estadiasDelPeriodo.mock.calls[0][2]).toEqual(new Date('2026-10-03T06:00:00.000Z'));
    expect(await json(r)).toMatchObject({ periodo: { desde: '2026-10-01', hasta: '2026-10-02' }, truncada: false });
  });

  it('sin credencial no lee nada (el 401/403 de la puerta pasa tal cual)', async () => {
    abrir.mockResolvedValue({ ok: false, respuesta: new Response(JSON.stringify({ error: { codigo: 'sin_permiso' } }), { status: 403 }) });
    expect((await estadias.GET(new Request(`${BASE}/estadias`))).status).toBe(403);
    expect(estadiasDelPeriodo).not.toHaveBeenCalled();
  });

  it.each([
    ['fechas mal escritas', 'desde=ayer&hasta=hoy'],
    ['desde posterior a hasta', 'desde=2026-10-05&hasta=2026-10-01'],
    ['periodo de un año', 'desde=2026-01-01&hasta=2026-12-31'],
    ['formato desconocido', 'desde=2026-10-01&hasta=2026-10-02&formato=xml'],
    ['uuid inválido en el filtro', 'desde=2026-10-01&hasta=2026-10-02&clienteId=no-uuid'],
    ['inyección en el filtro', "desde=2026-10-01&hasta=2026-10-02&operadorId=' or 1=1"],
  ])('400 en palabras: %s', async (_n, qs) => {
    const r = await estadias.GET(new Request(`${BASE}/estadias?${qs}`));
    expect(r.status).toBe(400);
    expect((await json(r)).error.codigo).toBe('parametro_invalido');
    expect(estadiasDelPeriodo).not.toHaveBeenCalled();
  });

  it('pasa los filtros (en minúsculas) al servicio', async () => {
    await estadias.GET(new Request(`${BASE}/estadias?desde=2026-10-01&hasta=2026-10-01&clienteId=${U.toUpperCase()}&terminalId=${V}`));
    expect(estadiasDelPeriodo.mock.calls[0][3]).toEqual({ clienteId: U, terminalId: V });
  });

  it('formato=csv: texto con BOM, cabecera, descarga, sin caché; y marca la lectura truncada', async () => {
    estadiasDelPeriodo.mockResolvedValueOnce({ filas: [], resumen: {}, truncada: true });
    const r = await estadias.GET(new Request(`${BASE}/estadias?desde=2026-10-01&hasta=2026-10-02&formato=csv`));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    expect(r.headers.get('content-disposition')).toContain('estadias-2026-10-01-a-2026-10-02.csv');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-estadias-truncada')).toBe('true');
    // `text()` decodifica y se come el BOM: se mira el crudo (EF BB BF) y luego el texto.
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect((await r.text()).startsWith('folio,viaje_id,chofer')).toBe(true);
  });

  it('el JSON NO trae monto de una parada que sigue corriendo (no es un cobro)', async () => {
    estadiasDelPeriodo.mockResolvedValueOnce({
      filas: [{
        viaje: { id: V, folio: 'F-1', operadorNombre: 'Juan', clienteNombre: 'C', terminalNombre: 'P' }, sitio: 'Planta', origenPolitica: 'cliente',
        estancia: { lugar: 'carga', fase: 'en_curso', minutos: 300, llegada: null, salida: null },
        detencion: { horasLibres: 2, minutosExcedentes: 180, horasCobrables: 3, monto: 1500, moneda: 'MXN', motivoSinMonto: null },
      }], resumen: {}, truncada: false,
    });
    const d = (await json(await estadias.GET(new Request(`${BASE}/estadias?desde=2026-10-01&hasta=2026-10-02`)))).datos[0];
    expect(d.detencion).toMatchObject({ monto: null, moneda: null, horasCobrables: null, minutosExcedentes: 180 });
  });

  it('una lectura que revienta es 500 sin filtrar el mensaje interno', async () => {
    estadiasDelPeriodo.mockRejectedValueOnce(new Error('relation "politica_detencion" does not exist'));
    const r = await estadias.GET(new Request(`${BASE}/estadias?desde=2026-10-01&hasta=2026-10-02`));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await json(r))).not.toContain('politica_detencion');
  });
});

describe('GET /v1/sitios', () => {
  it('pide el área operacion y acota a la flota de la credencial', async () => {
    const r = await sitios.GET(new Request(`${BASE}/sitios?tenant=t-OTRA&q=planta&tipo=planta`));
    expect(abrir.mock.calls[0][1]).toBe('operacion');
    expect(listarSitios.mock.calls[0][0]).toBe('t-1');
    expect(listarSitios.mock.calls[0][1]).toMatchObject({ busqueda: 'planta', tipo: 'planta' });
    expect((await json(r)).datos[0]).toMatchObject({ id: 's1', codigo: 'PL', radioM: 300, fuente: 'csv' });
  });
  it('un tipo desconocido es 400', async () => {
    expect((await sitios.GET(new Request(`${BASE}/sitios?tipo=bodega`))).status).toBe(400);
    expect(listarSitios).not.toHaveBeenCalled();
  });
});

describe('PUT /v1/viajes/{id}/sitios', () => {
  it('pide administracion; asigna por código o id, SIEMPRE dentro de la flota de la credencial', async () => {
    const r = await put(V, { origen: 'PL-ZAP', destino: U });
    expect(r.status).toBe(200);
    expect(abrir.mock.calls[0][1]).toBe('administracion');
    expect(asignarSitiosViaje).toHaveBeenCalledWith('t-1', V, { origen: 'PL-ZAP', destino: U });
  });
  it('null desasigna; un solo lado no toca el otro', async () => {
    await put(V, { destino: null });
    expect(asignarSitiosViaje).toHaveBeenCalledWith('t-1', V, { destino: null });
  });
  it('«no existe» y «no es de tu flota» contestan lo mismo (404)', async () => {
    asignarSitiosViaje.mockResolvedValueOnce('viaje_no_encontrado');
    expect((await put(V, { origen: 'X' })).status).toBe(404);
  });
  it('un sitio que no está en el catálogo de la flota es 400 en palabras', async () => {
    asignarSitiosViaje.mockResolvedValueOnce('sitio_no_encontrado');
    const r = await put(V, { origen: 'NO-EXISTE' });
    expect(r.status).toBe(400);
    expect((await json(r)).error.mensaje).toMatch(/catálogo/);
  });
  it.each([
    ['id que no es uuid', 'no-uuid', { origen: 'X' }],
    ['cuerpo vacío', V, {}],
    ['llave desconocida (un tenant_id en el cuerpo no es una puerta)', V, { origen: 'X', tenant_id: 't-OTRA' }],
    ['lado no texto', V, { origen: 42 }],
    ['lado vacío', V, { origen: '  ' }],
    ['lado larguísimo que no es uuid', V, { destino: 'x'.repeat(200) }],
    ['JSON roto', V, '{no es json'],
    ['arreglo', V, ['PL']],
  ])('400: %s', async (_n, id, cuerpo) => {
    const r = await put(id as string, cuerpo);
    expect(r.status).toBe(400);
    expect(asignarSitiosViaje).not.toHaveBeenCalled();
  });
  it('sin credencial no escribe', async () => {
    abrir.mockResolvedValue({ ok: false, respuesta: new Response(null, { status: 401 }) });
    expect((await put(V, { origen: 'X' })).status).toBe(401);
    expect(asignarSitiosViaje).not.toHaveBeenCalled();
  });
});
