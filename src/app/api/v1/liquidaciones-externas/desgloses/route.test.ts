import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/liquidaciones-externas/desgloses — plan B de la entrada del desglose (T-A1-21).
//
// Lo que se fija son las promesas de la puerta, no el servicio (ese tiene sus propias pruebas):
//   1. EL ÁREA: escribir es `administracion`; sin credencial no se lee, valida ni escribe nada.
//   2. EL TENANT SALE DE LA CREDENCIAL: un `tenant_id` en el sobre o en un desglose es 400.
//   3. ESTRICTA Y TODO-O-NADA: un campo desconocido, un neto que no cuadra o un renglón en cero en CUALQUIER elemento
//      es 400 con su índice, y no se escribe ninguno.
//   4. IDEMPOTENTE Y SIN SOBRESCRIBIR: lo repetido es 200 idempotente; otro contenido con la misma clave es una
//      excepción `correccion_pendiente`, nunca un reemplazo.
//   5. NO ENTREGA: la ruta solo recibe; ni siquiera importa el servicio de entrega.
//   6. NINGÚN ERROR INTERNO CRUZA al cuerpo.
// Todos los datos son sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

type Resultado = Awaited<ReturnType<typeof import('@/lib/likida/liquidacion_externa/desglose_recibir').recibirDesglose>>;
const creada = (clave: string, p: Partial<Extract<Resultado, { estado: 'creada' }>> = {}): Resultado => ({
  estado: 'creada', liquidacionId: `id-${clave}`, claveExterna: clave, entregas: 2, retenida: false, motivos: [], excepciones: [], ...p,
});

const recibir = vi.fn(async (_t: string, d: { bitacora: string; terminal?: string }, ..._r: unknown[]): Promise<Resultado> =>
  creada(`BIT-${d.terminal ? `${d.terminal}-` : ''}${d.bitacora}`));
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', () => ({
  recibirDesglose: (...a: [string, { bitacora: string }, ...unknown[]]) => recibir(...a),
}));

const { POST } = await import('./route');

const URL_BASE = 'https://app.likida.ai/api/v1/liquidaciones-externas/desgloses';
const DESGLOSE = (bitacora = 'B-0001', extra: Record<string, unknown> = {}) => ({
  terminal: 'T1', bitacora, poliza: 'P-1',
  operador: { numeroEmpleado: '1001' }, unidad: '0001', tipoOperador: 'foraneo',
  desde: '2026-10-09', hasta: '2026-10-14',
  percepciones: [{ concepto: 'Sueldo', monto: 4000 }, { concepto: 'Viáticos', monto: 1500.5 }],
  deducciones: [{ concepto: 'Anticipo', monto: 1000, vale: '*100001' }],
  neto: 4500.5,
  ...extra,
});
const postear = (cuerpo: unknown) =>
  POST(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
  recibir.mockReset();
  recibir.mockImplementation(async (_t, d) => creada(`BIT-${d.terminal ? `${d.terminal}-` : ''}${d.bitacora}`));
});

describe('la puerta', () => {
  it('abre con área `administracion`', async () => {
    await postear({ desgloses: [DESGLOSE()] });
    expect(abrir.mock.calls[0][1]).toBe('administracion');
  });

  it.each([401, 403])('sin llave o sin área (%i): no se valida ni se escribe nada', async (status) => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status }) });
    const r = await postear({ desgloses: [DESGLOSE()] });
    expect(r.status).toBe(status);
    expect(recibir).not.toHaveBeenCalled();
  });

  it('el tenant que recibe el servicio es el de la credencial', async () => {
    await postear({ desgloses: [DESGLOSE()] });
    expect(recibir.mock.calls[0][0]).toBe('t-1');
  });

  it('un `tenant_id` en el sobre o en el desglose es 400 y no se escribe nada', async () => {
    const a = await postear({ desgloses: [DESGLOSE()], tenant_id: 't-OTRO' });
    expect(a.status).toBe(400);
    expect((await json(a)).error.mensaje).toContain('tenant_id');
    const b = await postear({ desgloses: [DESGLOSE('B-1', { tenant_id: 't-OTRO' })] });
    expect(b.status).toBe(400);
    expect((await json(b)).error.mensaje).toContain('tenant_id');
    const c = await postear(DESGLOSE('B-1', { tenant_id: 't-OTRO' }));
    expect(c.status).toBe(400);
    expect(recibir).not.toHaveBeenCalled();
  });
});

describe('el cuerpo', () => {
  it('JSON roto, vacío o que no es objeto → 400 sin eco del parser', async () => {
    const roto = await postear('{no es json');
    expect(roto.status).toBe(400);
    expect(JSON.stringify(await json(roto))).not.toMatch(/Unexpected|position/i);
    for (const c of ['', '[]', '5', 'null']) expect((await postear(c)).status, c).toBe(400);
    expect(recibir).not.toHaveBeenCalled();
  });

  it('`desgloses` vacía, que no es lista o con más de 100 → 400', async () => {
    expect((await postear({ desgloses: [] })).status).toBe(400);
    expect((await postear({ desgloses: 'x' })).status).toBe(400);
    const muchos = await postear({ desgloses: Array.from({ length: 101 }, (_, i) => DESGLOSE(`B-${i}`)) });
    expect(muchos.status).toBe(400);
    expect((await json(muchos)).error.mensaje).toContain('100');
    expect(recibir).not.toHaveBeenCalled();
  });

  it('exactamente 100 desgloses es válido', async () => {
    const r = await postear({ desgloses: Array.from({ length: 100 }, (_, i) => DESGLOSE(`B-${i}`)) });
    expect(r.status).toBe(201);
    expect((await json(r)).datos.recibidas).toBe(100);
  });

  it('un campo extra en el desglose → 400 que lo nombra con su índice; no se escribe ninguno', async () => {
    const r = await postear({ desgloses: [DESGLOSE('B-1'), DESGLOSE('B-2', { campoExtra: 1 })] });
    expect(r.status).toBe(400);
    const msg = (await json(r)).error.mensaje as string;
    expect(msg).toContain('desgloses[1]');
    expect(msg).toContain('campoExtra');
    expect(recibir).not.toHaveBeenCalled();
  });

  it('un neto que no cuadra o un renglón en cero → 400 antes de escribir (todo o nada)', async () => {
    const noCuadra = await postear({ desgloses: [DESGLOSE('B-1'), DESGLOSE('B-2', { neto: 1 })] });
    expect(noCuadra.status).toBe(400);
    const enCero = await postear({ desgloses: [DESGLOSE('B-1', { percepciones: [{ concepto: 'Sueldo', monto: 0 }] })] });
    expect(enCero.status).toBe(400);
    expect(recibir).not.toHaveBeenCalled();
  });

  it('un objeto suelto (sin `desgloses`) se acepta como UN desglose', async () => {
    const r = await postear(DESGLOSE());
    expect(r.status).toBe(201);
    expect((await json(r)).datos).toMatchObject({ recibidas: 1, idempotentes: 0, retenidas: 0, excepciones: [] });
    expect(recibir).toHaveBeenCalledTimes(1);
  });
});

describe('el resultado', () => {
  it('un desglose válido → 201 con el conteo', async () => {
    const r = await postear({ desgloses: [DESGLOSE()] });
    expect(r.status).toBe(201);
    expect((await json(r)).datos).toEqual({ recibidas: 1, idempotentes: 0, retenidas: 0, excepciones: [] });
  });

  it('repetido → 200 idempotente, sin excepciones', async () => {
    recibir.mockResolvedValueOnce({ estado: 'idempotente', liquidacionId: 'id-1', claveExterna: 'BIT-T1-B-0001' });
    const r = await postear({ desgloses: [DESGLOSE()] });
    expect(r.status).toBe(200);
    expect((await json(r)).datos).toEqual({ recibidas: 0, idempotentes: 1, retenidas: 0, excepciones: [] });
  });

  it('huella distinta → excepción `correccion_pendiente` (200, nada nuevo se guardó)', async () => {
    recibir.mockResolvedValueOnce({ estado: 'correccion_pendiente', liquidacionId: 'id-1', claveExterna: 'BIT-T1-B-0001' });
    const r = await postear({ desgloses: [DESGLOSE()] });
    expect(r.status).toBe(200);
    expect((await json(r)).datos).toEqual({
      recibidas: 0, idempotentes: 0, retenidas: 0, excepciones: [{ clave: 'BIT-T1-B-0001', motivo: 'correccion_pendiente' }],
    });
  });

  it('operador inexistente → excepción `operador_no_encontrado`', async () => {
    recibir.mockResolvedValueOnce({ estado: 'operador_no_encontrado', claveExterna: 'BIT-T1-B-0001' });
    const r = await postear({ desgloses: [DESGLOSE()] });
    expect(r.status).toBe(200);
    expect((await json(r)).datos.excepciones).toEqual([{ clave: 'BIT-T1-B-0001', motivo: 'operador_no_encontrado' }]);
  });

  it('una guarda que retiene cuenta como retenida (201) y lista su motivo', async () => {
    recibir.mockResolvedValueOnce(creada('BIT-T1-B-0001', { entregas: 0, retenida: true, motivos: ['sin_poliza'], excepciones: ['sin_poliza'] }));
    const r = await postear({ desgloses: [DESGLOSE('B-0001', { poliza: null })] });
    expect(r.status).toBe(201);
    expect((await json(r)).datos).toEqual({
      recibidas: 0, idempotentes: 0, retenidas: 1, excepciones: [{ clave: 'BIT-T1-B-0001', motivo: 'sin_poliza' }],
    });
  });

  it('un lote mixto suma cada cosa en su cubeta, en orden', async () => {
    recibir
      .mockResolvedValueOnce(creada('BIT-T1-B-1'))
      .mockResolvedValueOnce({ estado: 'idempotente', liquidacionId: 'id-2', claveExterna: 'BIT-T1-B-2' })
      .mockResolvedValueOnce(creada('BIT-T1-B-3', { excepciones: ['operador_sin_correo'] }))
      .mockResolvedValueOnce({ estado: 'correccion_pendiente', liquidacionId: 'id-4', claveExterna: 'BIT-T1-B-4' });
    const r = await postear({ desgloses: ['B-1', 'B-2', 'B-3', 'B-4'].map((b) => DESGLOSE(b)) });
    expect(r.status).toBe(201);
    expect((await json(r)).datos).toEqual({
      recibidas: 2, idempotentes: 1, retenidas: 0,
      excepciones: [{ clave: 'BIT-T1-B-3', motivo: 'operador_sin_correo' }, { clave: 'BIT-T1-B-4', motivo: 'correccion_pendiente' }],
    });
    expect(recibir.mock.calls.map((c) => c[1].bitacora)).toEqual(['B-1', 'B-2', 'B-3', 'B-4']);
  });

  it('no entrega: el servicio se llama sin dependencias de envío y el origen queda marcado', async () => {
    await postear({ desgloses: [DESGLOSE()] });
    const args = recibir.mock.calls[0];
    expect(args[2]).toBeUndefined(); // dependencias por omisión: solo recibe y programa
    expect(args[3]).toEqual({ sistemaOrigen: 'desglose-bitacora-api' });
  });
});

describe('fallas de infraestructura', () => {
  it('una falla de Storage/base a mitad → 500 sin eco del error interno', async () => {
    recibir.mockResolvedValueOnce(creada('BIT-T1-B-1'));
    recibir.mockRejectedValueOnce(new Error('relation "liquidacion_externa" violates secreto-interno'));
    const r = await postear({ desgloses: [DESGLOSE('B-1'), DESGLOSE('B-2')] });
    expect(r.status).toBe(500);
    const txt = JSON.stringify(await json(r));
    expect(txt).not.toMatch(/relation|violates|secreto-interno/);
  });
});
