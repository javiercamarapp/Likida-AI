import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · M19 — la ruta de contribución (0.0% ejecutada) es la ÚNICA de
// viajes con área `dinero`: con `abrir(req, 'operacion')` una llave de
// operación —la del TMS o del jefe de tráfico— leía ingreso, comprobado,
// contribución y margen, y el OpenAPI seguía prometiendo lo contrario. Se
// fija el argumento real de `abrir` y el 404 para un viaje ajeno.
// ═══════════════════════════════════════════════════════════════════════════

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:dinero' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
const getLibroViaje = vi.fn(async (_t: string, _id: string): Promise<Record<string, unknown> | null> => null);
vi.mock('@/lib/likida/libro_viaje', () => ({ getLibroViaje: (...a: [string, string]) => getLibroViaje(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const ID = '11111111-2222-3333-4444-555555555555';
const pedir = (id = ID) => GET(new Request(`https://app.likida.ai/api/v1/viajes/${id}/contribucion`), { params: Promise.resolve({ id }) });

beforeEach(() => { abrir.mockClear(); getLibroViaje.mockClear(); });

describe('GET /v1/viajes/{id}/contribucion', () => {
  it('abre con área `dinero` — la que el OpenAPI declara', async () => {
    await pedir();
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0][1]).toBe('dinero');
  });

  it('si la puerta no abre, devuelve SU respuesta sin leer el libro', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 403 }) });
    const r = await pedir();
    expect(r.status).toBe(403);
    expect(getLibroViaje).not.toHaveBeenCalled();
  });

  it('un id que no es uuid es 400 sin tocar la base', async () => {
    const r = await pedir('abc');
    expect(r.status).toBe(400);
    expect(getLibroViaje).not.toHaveBeenCalled();
  });

  it('el libro se lee con el tenant de la CREDENCIAL y el id de la URL; un viaje ajeno es 404', async () => {
    const r = await pedir();
    expect(getLibroViaje).toHaveBeenCalledWith('t-1', ID);
    expect(r.status).toBe(404);
  });

  it('con renglón, los `null` viajan como null (no como 0) y `falta` dice qué falta', async () => {
    getLibroViaje.mockResolvedValueOnce({
      viajeId: ID, folio: 'V-1', estatus: 'liquidado', cliente: null,
      ingreso: null, comprobado: 1500, contribucion: null, margenPct: null,
      falta: 'Falta capturar el ingreso del flete.', liquidacionId: 'l-1',
      documental: { comprobantes: 3 }, observaciones: [], cobro: { facturada: false },
    });
    const r = await pedir();
    expect(r.status).toBe(200);
    const { datos } = await r.json() as { datos: Record<string, unknown> };
    expect(datos.ingreso).toBeNull();
    expect(datos.contribucion).toBeNull();
    expect(datos.comprobado).toBe(1500);
    expect(datos.falta).toContain('ingreso');
  });
});
