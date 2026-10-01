import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// POST/GET /v1/liquidaciones-externas — la puerta del modo «solo entrega».
//
// Lo que se fija no es que la ruta «funcione» sino sus promesas:
//
//   1. EL ÁREA: escribir es `administracion` (termina en el teléfono de una
//      persona con la firma de su patrón), leer es `dinero`.
//   2. LA IDEMPOTENCIA POR CLAVE EXTERNA: el mismo folio con el mismo contenido
//      es 200 `idempotente` (un reintento tras un timeout); con OTRO contenido
//      es 409 — jamás se sobrescribe lo que el chofer pudo ya haber visto.
//   3. EL 201 ES «RECIBIDA», no «entregada»: la entrega no es parte de la
//      promesa del POST, y un fallo de entrega no convierte una recepción
//      exitosa en un 500 (el TMS reintentaría algo ya guardado).
//   4. EL TENANT SALE DE LA CREDENCIAL: un `tenant_id` en el cuerpo es 400.
//   5. LO QUE NO SALE: ni ruta de Storage, ni URL firmada, ni teléfono.
// ═══════════════════════════════════════════════════════════════════════════

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

import type { LiquidacionExterna } from '@/lib/likida/liquidacion_externa/repo';

const baseFila = (p: Partial<LiquidacionExterna> = {}): LiquidacionExterna => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: 't-1', claveExterna: 'SAP-1', huella: 'x'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Juan Pérez', operadorTelefono: '525512345678',
  foliosViaje: ['VJ-1'], viajeIds: ['v-1'], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07',
  conceptos: [{ clave: null, descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN',
  pdfRuta: 't-1/externas/SECRETA.pdf', pdfOrigen: 'generado', estado: 'pendiente', via: null, generacion: 1, intentos: 0,
  proximoIntentoEn: 'x', ultimoError: null, wamid: null, enviadaEn: null, acuseTipo: null, acuseEn: null,
  creadaEn: '2026-09-08T09:00:00.000Z', ...p,
});

let existente: LiquidacionExterna | null = null;
let fallaCreacion: Error | null = null;
let estadoTrasEntrega: Partial<LiquidacionExterna> = { estado: 'en_cola', via: 'sesion' };
const recibir = vi.fn(async (_t: string, _d: unknown, h: string) => {
  if (fallaCreacion) throw fallaCreacion;
  return { liquidacion: baseFila({ huella: h }) };
});
const intentar = vi.fn(async (..._a: unknown[]) => 'en_cola');
const buscar = vi.fn(async (_t: string, _c: string) => existente);
const leer = vi.fn(async (_t: string, _id: string): Promise<LiquidacionExterna | null> => baseFila(estadoTrasEntrega));
const listar = vi.fn(async (..._a: unknown[]): Promise<{ filas: LiquidacionExterna[]; hayMas: boolean; total: number | null }> => ({ filas: [], hayMas: false, total: null }));

vi.mock('@/lib/likida/liquidacion_externa/servicio', () => ({
  recibirLiquidacionExterna: (...a: [string, unknown, string]) => recibir(...a),
  intentarEntrega: (...a: unknown[]) => intentar(...a),
}));
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/liquidacion_externa/repo')>()),
  buscarPorClave: (...a: [string, string]) => buscar(...a),
  leerPorId: (...a: [string, string]) => leer(...a),
  listarLiquidacionesExternas: (...a: unknown[]) => listar(...a),
}));

const { GET, POST } = await import('./route');
const { reiniciarIdempotencia } = await import('../_escritura');
const { huellaContenido, validarLiquidacionExterna } = await import('@/lib/likida/liquidacion_externa/esquema');
const { DatoInvalido } = await import('@/lib/likida/errores');

const URL_BASE = 'https://app.likida.ai/api/v1/liquidaciones-externas';
const CUERPO = () => ({
  claveExterna: 'SAP-1', sistemaOrigen: 'SAP', operador: { telefono: '5512345678' }, viajes: ['VJ-1'],
  periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
  conceptos: [{ descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN',
});
const postear = (cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  POST(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
  recibir.mockClear(); intentar.mockClear(); buscar.mockClear(); leer.mockClear(); listar.mockClear();
  existente = null; fallaCreacion = null; estadoTrasEntrega = { estado: 'en_cola', via: 'sesion' };
  reiniciarIdempotencia();
});

describe('POST — la puerta', () => {
  it('abre con área `administracion`', async () => {
    await postear(CUERPO());
    expect(abrir.mock.calls[0][1]).toBe('administracion');
  });

  it('si la puerta no abre, no se valida ni se escribe nada', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 403 }) });
    const r = await postear(CUERPO());
    expect(r.status).toBe(403);
    expect(recibir).not.toHaveBeenCalled();
  });
});

describe('POST — el cuerpo', () => {
  it('JSON roto → 400 sin eco del parser', async () => {
    const r = await postear('{no es json');
    expect(r.status).toBe(400);
    expect(JSON.stringify(await json(r))).not.toMatch(/Unexpected|position/i);
  });

  it('un cuerpo que no es objeto (lista, número, null) → 400', async () => {
    for (const c of ['[]', '5', 'null', '"x"']) expect((await postear(c)).status, c).toBe(400);
    expect(recibir).not.toHaveBeenCalled();
  });

  it('un cuerpo vacío → 400', async () => {
    expect((await postear('')).status).toBe(400);
  });

  it('un campo desconocido → 400 que lo nombra; `tenant_id` no se acepta NUNCA', async () => {
    const r = await postear({ ...CUERPO(), tenant_id: 't-OTRO' });
    expect(r.status).toBe(400);
    expect((await json(r)).error.mensaje).toContain('tenant_id');
    expect(recibir).not.toHaveBeenCalled();
  });

  it('un total que no cuadra → 400 con la diferencia, sin escribir', async () => {
    const r = await postear({ ...CUERPO(), total: 101 });
    expect(r.status).toBe(400);
    expect((await json(r)).error.mensaje).toMatch(/no es la suma/);
    expect(recibir).not.toHaveBeenCalled();
  });

  it('un cuerpo de más de lo permitido (PDF + JSON) se corta ANTES de parsearlo', async () => {
    const r = await postear(`{"claveExterna":"${'x'.repeat(2_000_000)}"}`);
    expect(r.status).toBe(400);
    expect((await json(r)).error.mensaje).toMatch(/no puede pasar de \d+ bytes/);
  });

  it('el cuerpo admite un PDF de ~1 MB (el tope de 16 KB de las otras rutas NO aplica aquí)', async () => {
    const pdf = `%PDF-1.4\n${'A'.repeat(900_000)}\n%%EOF\n`;
    const r = await postear({ ...CUERPO(), pdf: { base64: Buffer.from(pdf).toString('base64') } });
    expect(r.status).toBe(201);
  });
});

describe('POST — la idempotencia por clave externa', () => {
  it('lo nuevo es 201, `idempotente: false`, y se intenta entregar de inmediato', async () => {
    const r = await postear(CUERPO());
    expect(r.status).toBe(201);
    const j = await json(r);
    expect(j.idempotente).toBe(false);
    expect(j.dato).toMatchObject({ claveExterna: 'SAP-1', estado: 'en_cola', via: 'sesion', moneda: 'MXN', total: 100 });
    expect(recibir).toHaveBeenCalledTimes(1);
    expect(intentar).toHaveBeenCalledTimes(1);
  });

  it('acusa el estado REAL tras intentar entregar (releído), no el de antes', async () => {
    estadoTrasEntrega = { estado: 'enviada', via: 'sesion', wamid: 'w' };
    const j = await json(await postear(CUERPO()));
    expect(j.dato.estado).toBe('enviada');
    expect(leer).toHaveBeenCalledWith('t-1', expect.any(String));
  });

  it('el mismo folio con el MISMO contenido → 200 idempotente, sin crear nada', async () => {
    const huella = huellaContenido(validarLiquidacionExterna(CUERPO()));
    existente = baseFila({ huella, estado: 'enviada', via: 'sesion' });
    const r = await postear(CUERPO());
    expect(r.status).toBe(200);
    const j = await json(r);
    expect(j.idempotente).toBe(true);
    expect(j.dato.estado).toBe('enviada');
    expect(recibir).not.toHaveBeenCalled();
    expect(intentar).not.toHaveBeenCalled();
  });

  it('el mismo folio con OTRO contenido → 409: no se sobrescribe lo que el chofer pudo haber visto', async () => {
    existente = baseFila({ huella: 'otra'.padEnd(64, '0') });
    const r = await postear(CUERPO());
    expect(r.status).toBe(409);
    const j = await json(r);
    expect(j.error.codigo).toBe('conflicto');
    expect(j.error.mensaje).toMatch(/claveExterna.*nueva/);
    expect(recibir).not.toHaveBeenCalled();
  });

  it('un reintento IDÉNTICO tras el 201 devuelve la misma respuesta con la cabecera de eco', async () => {
    const a = await postear(CUERPO());
    const b = await postear(CUERPO());
    expect(b.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await json(b)).toEqual(await json(a));
    expect(recibir).toHaveBeenCalledTimes(1);
  });

  it('la carrera: otra petición insertó entre el buscar y el crear → se relee y se contesta la que ganó (200)', async () => {
    const huella = huellaContenido(validarLiquidacionExterna(CUERPO()));
    buscar.mockResolvedValueOnce(null).mockResolvedValueOnce(baseFila({ huella }));
    fallaCreacion = new Error('liquidacion_externa insertar: duplicate key value violates unique constraint "liquidacion_externa_clave_unica"');
    const r = await postear(CUERPO());
    expect(r.status).toBe(200);
    expect((await json(r)).idempotente).toBe(true);
  });

  it('la carrera con OTRO contenido ganador → 409', async () => {
    buscar.mockResolvedValueOnce(null).mockResolvedValueOnce(baseFila({ huella: 'z'.repeat(64) }));
    fallaCreacion = new Error('duplicate key value violates unique constraint "liquidacion_externa_clave_unica"');
    expect((await postear(CUERPO())).status).toBe(409);
  });

  it('`Idempotency-Key` es OPCIONAL: sin ella se deriva de la clave externa; con una mal formada es 400', async () => {
    expect((await postear(CUERPO())).status).toBe(201);
    expect((await postear({ ...CUERPO(), claveExterna: 'SAP-2' }, { 'Idempotency-Key': 'corta' })).status).toBe(400);
    expect((await postear({ ...CUERPO(), claveExterna: 'SAP-3' }, { 'Idempotency-Key': 'una-llave-de-prueba-1' })).status).toBe(201);
  });

  it('la misma Idempotency-Key con OTRO cuerpo es 400 (llave reusada), no un eco', async () => {
    await postear(CUERPO(), { 'Idempotency-Key': 'llave-reusada-0001' });
    const r = await postear({ ...CUERPO(), total: 100, conceptos: [{ descripcion: 'Otro', tipo: 'percepcion', monto: 100 }] }, { 'Idempotency-Key': 'llave-reusada-0001' });
    expect(r.status).toBe(400);
  });
});

describe('POST — lo que falla del lado del cliente o del nuestro', () => {
  it('un operador que no existe / está de baja es 400 con el motivo (determinista: reintentar no lo arregla)', async () => {
    fallaCreacion = new DatoInvalido('No encontré a ese operador en tu flota.');
    const r = await postear(CUERPO());
    expect(r.status).toBe(400);
    expect((await json(r)).error.mensaje).toMatch(/operador/);
  });

  it('una falla nuestra es 500 genérico: NO cruza el mensaje interno', async () => {
    fallaCreacion = new Error('relation "liquidacion_externa" does not exist at storage.objects');
    const r = await postear(CUERPO());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await json(r))).not.toMatch(/relation|storage\.objects|liquidacion_externa/);
  });

  it('una falla de ENTREGA no convierte la recepción en error: intentarEntrega no lanza y el POST sigue siendo 201', async () => {
    estadoTrasEntrega = { estado: 'pendiente', via: null, ultimoError: 'outbox no respondió' };
    const r = await postear(CUERPO());
    expect(r.status).toBe(201);
    const j = await json(r);
    expect(j.dato.estado).toBe('pendiente');
    expect(j.dato.fallo).toMatchObject({ codigo: 'entrega_interna' });
  });
});

describe('POST — lo que NO sale en la respuesta', () => {
  it('ni la ruta de Storage, ni URLs firmadas, ni el teléfono del chofer, ni la huella', async () => {
    const texto = JSON.stringify(await json(await postear(CUERPO())));
    expect(texto).not.toMatch(/SECRETA|externas\/|525512345678|operadorTelefono|huella|pdfRuta|generacion|token/);
  });

  it('el error de Meta crudo (con el cuerpo de su JSON) no cruza: sale un código estable y una frase', async () => {
    estadoTrasEntrega = { estado: 'fallida', via: 'sesion', ultimoError: 'terminal:HTTP 400: {"error":{"code":131030,"message":"Recipient phone number not in allowed list","fbtrace_id":"AbC"}}' };
    const j = await json(await postear(CUERPO()));
    expect(j.dato.fallo.codigo).toBe('numero_no_permitido');
    expect(JSON.stringify(j)).not.toMatch(/fbtrace|Recipient phone/);
  });
});

describe('GET', () => {
  const get = (qs = '') => GET(new Request(`${URL_BASE}${qs}`));

  it('abre con área `dinero` (el encargado no ve cifras)', async () => {
    await get();
    expect(abrir.mock.calls[0][1]).toBe('dinero');
  });

  it('lista con sobre estándar, cursor siguiente y el filtro que se aplicó', async () => {
    listar.mockResolvedValueOnce({ filas: [baseFila({ id: 'a1111111-1111-4111-8111-111111111111' })], hayMas: true, total: null });
    const j = await json(await get('?estado=enviada&limite=1'));
    expect(j.datos).toHaveLength(1);
    expect(j.pagina).toMatchObject({ limite: 1, hayMas: true });
    expect(typeof j.pagina.siguiente).toBe('string');
    expect(j.filtro).toMatchObject({ estado: 'enviada', operadorId: null });
    expect(listar).toHaveBeenCalledWith('t-1', { estado: 'enviada' }, 1, null, false);
  });

  it('la última página: siguiente null', async () => {
    listar.mockResolvedValueOnce({ filas: [baseFila()], hayMas: false, total: null });
    expect((await json(await get())).pagina.siguiente).toBeNull();
  });

  it('el cursor de la respuesta es el que se acepta en `despues`', async () => {
    listar.mockResolvedValueOnce({ filas: [baseFila()], hayMas: true, total: null });
    const sig = (await json(await get('?limite=1'))).pagina.siguiente as string;
    await get(`?limite=1&despues=${sig}`);
    expect(listar.mock.calls[1][3]).toEqual({ creadoEn: '2026-09-08T09:00:00.000Z', id: '11111111-1111-4111-8111-111111111111' });
  });

  it('filtros inválidos son 400 y no consultan: estado desconocido, uuid mal formado, fechas imposibles, rango invertido', async () => {
    for (const qs of ['?estado=entregada', '?operadorId=x', '?desde=2026-02-30', '?hasta=ayer', '?desde=2026-09-10&hasta=2026-09-01', '?claveExterna=' + 'x'.repeat(121), '?despues=basura-que-no-es-cursor', '?limite=0', '?limite=201', '?desplazamiento=5']) {
      expect((await get(qs)).status, qs).toBe(400);
    }
    expect(listar).not.toHaveBeenCalled();
  });

  it('un error de base es 500 genérico, sin el mensaje de Postgres', async () => {
    listar.mockRejectedValueOnce(new Error('relation "liquidacion_externa" does not exist'));
    const r = await get();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await json(r))).not.toMatch(/relation|liquidacion_externa/);
  });

  it('la lista no lleva rutas de Storage ni el teléfono', async () => {
    listar.mockResolvedValueOnce({ filas: [baseFila()], hayMas: false, total: null });
    expect(JSON.stringify(await json(await get()))).not.toMatch(/SECRETA|externas\/|525512345678/);
  });

  it('con una llave sin acceso, no se lee nada', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 403 }) });
    expect((await get()).status).toBe(403);
    expect(listar).not.toHaveBeenCalled();
  });
});
