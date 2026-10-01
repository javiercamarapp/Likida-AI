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
vi.mock('@/lib/likida/conductor/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/conductor/repo')>()),
  leerHitos: (...a: unknown[]) => leerHitos(...a),
  leerEventos: (...a: unknown[]) => leerEventos(...a),
  guardarCitas: (...a: unknown[]) => guardarCitas(...a),
}));

const hitos = await import('./route');
const eventos = await import('./eventos/route');
const citas = await import('../viajes/[id]/citas/route');

const BASE = 'https://app.likida.ai/api/v1';
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const put = (id: string, cuerpo: unknown) => citas.PUT(
  new Request(`${BASE}/viajes/${id}/citas`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:operacion' });
  leerHitos.mockClear(); leerEventos.mockClear(); guardarCitas.mockClear();
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
