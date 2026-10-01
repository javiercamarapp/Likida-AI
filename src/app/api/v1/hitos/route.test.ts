import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /v1/hitos, GET /v1/hitos/eventos y PUT /v1/viajes/{id}/citas — las puertas.
// Lo que se fija: el ÁREA (operación para leer, administración para escribir), que el
// TENANT sale de la credencial y nada del cuerpo ni de la query lo cambia, que los
// filtros inválidos son 400 en palabras, y que «no existe» y «no es tuyo» son lo mismo.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:operacion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const leerHitos = vi.fn(async (..._a: unknown[]) => ({ filas: [{ id: 'h1' }], hayMas: false }));
const leerEventos = vi.fn(async (..._a: unknown[]) => ({ filas: [{ id: 7 }, { id: 9 }], hayMas: true }));
const guardarCitas = vi.fn(async (..._a: unknown[]): Promise<'ok' | 'no_encontrado'> => 'ok');
const leerConfig = vi.fn(async (..._a: unknown[]) => ({ ...{ activo: true, solicitudesMin: [0, 15, 30, 45], escalarTrasMin: 90, segundoNivelMin: 30, horaInicio: 6, horaFin: 22, diasSemana: [1, 2, 3, 4, 5, 6, 7], topeDiarioChofer: 12, anticipoCitaMin: 30, esperaSinCitaMin: 120, esperaCargaMin: 120, trayectoSinEtaMin: 480, esperaDescargaMin: 120, regresoMin: 30, posponerMin: 30, ventanaCorreccionMin: 60, usarLlm: true, avisarOficinaLlegada: false, avisarOficinaSalida: false, confirmarAlChofer: true } }));
const cargarContactos = vi.fn(async (..._a: unknown[]) => [{ nombre: 'Patio', telefono: '523312345678', nivel: 1, terminalId: null }]);
const guardarConfig = vi.fn(async (..._a: unknown[]): Promise<'ok' | 'terminal_ajena'> => 'ok');
vi.mock('@/lib/likida/conductor/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/conductor/repo')>()),
  leerHitos: (...a: unknown[]) => leerHitos(...a),
  leerEventos: (...a: unknown[]) => leerEventos(...a),
  guardarCitas: (...a: unknown[]) => guardarCitas(...a),
  leerConfigConductor: (...a: unknown[]) => leerConfig(...a),
  cargarContactosTrafico: (...a: unknown[]) => cargarContactos(...a),
  guardarConfigConductor: (...a: unknown[]) => guardarConfig(...a),
}));

const hitos = await import('./route');
const eventos = await import('./eventos/route');
const citas = await import('../viajes/[id]/citas/route');
const configRuta = await import('../conductor/config/route');

const BASE = 'https://app.likida.ai/api/v1';
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const put = (id: string, cuerpo: unknown) => citas.PUT(
  new Request(`${BASE}/viajes/${id}/citas`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:operacion' });
  leerHitos.mockClear(); leerEventos.mockClear(); guardarCitas.mockClear(); guardarConfig.mockClear(); leerConfig.mockClear(); cargarContactos.mockClear();
});

describe('GET /v1/hitos', () => {
  it('pide el área operacion y acota SIEMPRE a la flota de la credencial', async () => {
    const r = await hitos.GET(new Request(`${BASE}/hitos?tenant=t-OTRA&estado=escalado`));
    expect(r.status).toBe(200);
    expect(abrir.mock.calls[0][1]).toBe('operacion');
    expect(leerHitos.mock.calls[0][0]).toBe('t-1');
    expect(leerHitos.mock.calls[0][1]).toEqual({ estado: 'escalado' });
    expect((await json(r)).datos).toEqual([{ id: 'h1' }]);
  });

  it('sin credencial no lee nada', async () => {
    const respuesta = new Response(JSON.stringify({ error: { codigo: 'no_autenticado' } }), { status: 401 });
    abrir.mockResolvedValue({ ok: false, respuesta });
    const r = await hitos.GET(new Request(`${BASE}/hitos`));
    expect(r.status).toBe(401);
    expect(leerHitos).not.toHaveBeenCalled();
  });

  it.each(['estado=visto', 'tipo=x', 'viajeId=1', 'desde=ayer', 'limite=0', 'limite=500', 'desplazamiento=-1'])('«%s» → 400 sin tocar la base', async (q) => {
    const r = await hitos.GET(new Request(`${BASE}/hitos?${q}`));
    expect(r.status).toBe(400);
    expect((await json(r)).error.codigo).toBe('parametro_invalido');
    expect(leerHitos).not.toHaveBeenCalled();
  });

  it('una lectura que revienta es 500 sin filtrar el mensaje interno', async () => {
    leerHitos.mockRejectedValueOnce(new Error('relation "viaje_hito" does not exist'));
    const r = await hitos.GET(new Request(`${BASE}/hitos`));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await json(r))).not.toContain('viaje_hito');
  });

  it('pagina con límite y desplazamiento', async () => {
    await hitos.GET(new Request(`${BASE}/hitos?limite=20&desplazamiento=40`));
    expect(leerHitos.mock.calls[0].slice(2)).toEqual([20, 40]);
  });
});

describe('GET /v1/hitos/eventos', () => {
  it('devuelve el feed con el cursor del último id', async () => {
    const r = await eventos.GET(new Request(`${BASE}/hitos/eventos?despues=5&limite=2`));
    const c = await json(r);
    expect(leerEventos.mock.calls[0]).toEqual(['t-1', 5, 2]);
    expect(c.pagina).toEqual({ limite: 2, devueltos: 2, hayMas: true, siguiente: '9' });
    expect(abrir.mock.calls[0][1]).toBe('operacion');
  });

  it('sin eventos el cursor se queda donde estaba (el integrador no retrocede)', async () => {
    leerEventos.mockResolvedValueOnce({ filas: [], hayMas: false });
    const c = await json(await eventos.GET(new Request(`${BASE}/hitos/eventos?despues=42`)));
    expect(c.pagina.siguiente).toBe('42');
  });

  it.each(['despues=abc', 'despues=-1', 'despues=1.5', `despues=${'9'.repeat(20)}`, 'limite=0', 'limite=201', 'limite=x'])('«%s» → 400', async (q) => {
    expect((await eventos.GET(new Request(`${BASE}/hitos/eventos?${q}`))).status).toBe(400);
    expect(leerEventos).not.toHaveBeenCalled();
  });
});

describe('PUT /v1/viajes/{id}/citas', () => {
  it('pide el área administracion, acota por la flota de la credencial y devuelve lo guardado', async () => {
    const r = await put(V, { citaOrigen: '2026-10-02T08:00:00-06:00', tenant_id: 't-OTRA' });
    expect(r.status).toBe(200);
    expect(abrir.mock.calls[0][1]).toBe('administracion');
    expect(guardarCitas).toHaveBeenCalledWith('t-1', V, { cita_origen_en: '2026-10-02T14:00:00.000Z' });
    expect((await json(r)).datos).toEqual({ viajeId: V, cita_origen_en: '2026-10-02T14:00:00.000Z' });
  });

  it('«no existe» y «no es de tu flota» contestan lo MISMO (404): no es un oráculo de existencia', async () => {
    guardarCitas.mockResolvedValueOnce('no_encontrado');
    const r = await put(V, { citaOrigen: '2026-10-02T08:00:00Z' });
    expect(r.status).toBe(404);
    expect((await json(r)).error.codigo).toBe('no_encontrado');
  });

  it.each([
    ['id que no es uuid', 'xx', { citaOrigen: '2026-10-02T08:00:00Z' }],
    ['cuerpo vacío', V, {}],
    ['fecha sin zona', V, { citaOrigen: '2026-10-02T08:00:00' }],
    ['JSON roto', V, '{no es json'],
    ['lista', V, '[1]'],
  ])('400 sin tocar la base: %s', async (_n, id, cuerpo) => {
    const r = await put(id, cuerpo);
    expect(r.status).toBe(400);
    expect(guardarCitas).not.toHaveBeenCalled();
  });

  it('una llave de solo operacion NO puede mover citas (la puerta la pide el área)', async () => {
    const respuesta = new Response(JSON.stringify({ error: { codigo: 'sin_permiso' } }), { status: 403 });
    abrir.mockResolvedValue({ ok: false, respuesta });
    expect((await put(V, { citaOrigen: '2026-10-02T08:00:00Z' })).status).toBe(403);
    expect(guardarCitas).not.toHaveBeenCalled();
  });

  it('un cuerpo enorme se rechaza antes de parsearlo', async () => {
    const r = await put(V, JSON.stringify({ citaOrigen: '2026-10-02T08:00:00Z', basura: 'x'.repeat(20_000) }));
    expect(r.status).toBe(400);
  });
});

describe('GET/PUT /v1/conductor/config', () => {
  const putConfig = (cuerpo: unknown) => configRuta.PUT(new Request(`${BASE}/conductor/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }));

  it('GET pide el área administracion (trae teléfonos) y acota a la flota de la credencial', async () => {
    const r = await configRuta.GET(new Request(`${BASE}/conductor/config?tenant=t-OTRA`));
    expect(abrir.mock.calls[0][1]).toBe('administracion');
    expect(leerConfig.mock.calls[0][0]).toBe('t-1');
    expect(cargarContactos.mock.calls[0][0]).toBe('t-1');
    expect((await json(r)).datos.config.solicitudesMin).toEqual([0, 15, 30, 45]);
  });

  it('PUT fusiona con la config actual, valida y guarda para la flota de la credencial', async () => {
    const r = await putConfig({ solicitudesMin: [0, 10, 20], avisarOficinaLlegada: true, contactos: [{ nivel: 2, nombre: 'Jefe', telefono: '3312345678' }] });
    expect(r.status).toBe(200);
    expect(abrir.mock.calls[0][1]).toBe('administracion');
    const [tenant, config, contactos] = guardarConfig.mock.calls[0] as [string, Record<string, unknown>, unknown[]];
    expect(tenant).toBe('t-1');
    expect(config).toMatchObject({ solicitudesMin: [0, 10, 20], avisarOficinaLlegada: true, escalarTrasMin: 90 });
    expect(contactos).toEqual([{ nivel: 2, nombre: 'Jefe', telefono: '523312345678', terminalId: null }]);
  });

  it('un tenant_id en el cuerpo es una llave desconocida: no es una puerta a otra flota', async () => {
    const r = await putConfig({ tenant_id: 't-OTRA', activo: false });
    expect(r.status).toBe(400);
    expect(guardarConfig).not.toHaveBeenCalled();
  });

  it('una config inválida no se guarda a medias', async () => {
    expect((await putConfig({ solicitudesMin: [0, 60, 120] })).status).toBe(400);
    expect((await putConfig('{roto')).status).toBe(400);
    expect(guardarConfig).not.toHaveBeenCalled();
  });

  it('una terminal de OTRA flota es 400 (la FK compuesta lo dice) y no se confirma como guardado', async () => {
    guardarConfig.mockResolvedValueOnce('terminal_ajena');
    const r = await putConfig({ contactos: [{ nivel: 1, nombre: 'X', telefono: '3312345678', terminalId: '38000000-0000-4000-8000-0000000000b5' }] });
    expect(r.status).toBe(400);
    expect((await json(r)).error.mensaje).toContain('terminal');
  });

  it('una llave de solo operacion no puede cambiar ni leer la estrategia', async () => {
    abrir.mockResolvedValue({ ok: false, respuesta: new Response('{}', { status: 403 }) });
    expect((await putConfig({ activo: false })).status).toBe(403);
    expect((await configRuta.GET(new Request(`${BASE}/conductor/config`))).status).toBe(403);
    expect(guardarConfig).not.toHaveBeenCalled();
  });

  it('el mensaje interno de una falla de la base no cruza', async () => {
    guardarConfig.mockRejectedValueOnce(new Error('relation "agente_conductor_config" does not exist'));
    const r = await putConfig({ activo: false });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await json(r))).not.toContain('agente_conductor_config');
  });
});
