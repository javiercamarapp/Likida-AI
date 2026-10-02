import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL ACCESO A DATOS: tenant en CADA consulta, errores por valor que LANZAN, y
// la resolución del operador que decide a QUÉ teléfono se manda un pago.
//
// La base es un registrador de cadenas: cada `.from()` devuelve un constructor
// encadenable que anota los verbos que se le aplicaron y contesta lo que el
// caso programó. Así se comprueba lo que de verdad importa de un acceso a
// datos: QUÉ se le pidió a la base (filtros, tenant, condición de estado).
// ═══════════════════════════════════════════════════════════════════════════

type Op = [string, ...unknown[]];
interface Llamada { tabla: string; ops: Op[] }
const llamadas: Llamada[] = [];
/** Las RPC (`supabaseAdmin().rpc`): nombre y argumentos; contestan de la misma cola que las consultas. */
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
let respuestas: Array<{ data?: unknown; error?: { message: string; code?: string } | null; count?: number | null }> = [];

function constructor(tabla: string) {
  const ll: Llamada = { tabla, ops: [] };
  llamadas.push(ll);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'gte', 'lt', 'or', 'order', 'range', 'limit', 'neq']) {
    b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
  }
  const resolver = () => respuestas.shift() ?? { data: [], error: null, count: 0 };
  b.maybeSingle = async () => { ll.ops.push(['maybeSingle']); return resolver(); };
  b.single = async () => { ll.ops.push(['single']); return resolver(); };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej);
  return b;
}
const upload = vi.fn(async (..._a: unknown[]): Promise<{ error: { message: string } | null }> => ({ error: null }));
const createSignedUrl = vi.fn(async (..._a: unknown[]): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> => ({ data: { signedUrl: 'https://firmada' }, error: null }));
const bucketsUsados: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: constructor,
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return respuestas.shift() ?? { data: null, error: null }; },
    storage: { from: (b: string) => { bucketsUsados.push(b); return { upload, createSignedUrl }; } },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() } }));

const repo = await import('./repo');
const ID_OP = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const opFila = (p: Record<string, unknown> = {}) => ({ id: ID_OP, nombre: 'Juan Pérez', telefono: '525512345678', activo: true, ...p });
const tieneEq = (l: Llamada, col: string, v: unknown) => l.ops.some((o) => o[0] === 'eq' && o[1] === col && o[2] === v);

beforeEach(() => {
  llamadas.length = 0; rpcs.length = 0; respuestas = []; warn.mockReset(); bucketsUsados.length = 0;
  upload.mockReset(); upload.mockResolvedValue({ error: null });
  createSignedUrl.mockReset(); createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://firmada' }, error: null });
});

describe('resolverOperadorDestino', () => {
  it('por id: filtra por tenant Y por id', async () => {
    respuestas = [{ data: [opFila()], error: null }];
    const o = await repo.resolverOperadorDestino('t-1', { id: ID_OP, telefono: null, numeroEmpleado: null });
    expect(o).toMatchObject({ id: ID_OP, nombre: 'Juan Pérez', telefono: '525512345678', activo: true });
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(llamadas[0], 'id', ID_OP)).toBe(true);
  });

  it('por teléfono: busca las variantes mexicanas, siempre dentro del tenant', async () => {
    respuestas = [{ data: [opFila({ telefono: '5215512345678' })], error: null }];
    await repo.resolverOperadorDestino('t-1', { id: null, telefono: '525512345678', numeroEmpleado: null });
    const inOp = llamadas[0].ops.find((o) => o[0] === 'in')!;
    expect(inOp[1]).toBe('telefono');
    expect(inOp[2]).toEqual(expect.arrayContaining(['525512345678', '5215512345678']));
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
  });

  it('por número de empleado', async () => {
    respuestas = [{ data: [opFila()], error: null }];
    await repo.resolverOperadorDestino('t-1', { id: null, telefono: null, numeroEmpleado: 'E-77' });
    expect(tieneEq(llamadas[0], 'numero_empleado', 'E-77')).toBe(true);
  });

  it('no existe en la flota → DatoInvalido que dice qué mandar', async () => {
    respuestas = [{ data: [], error: null }];
    await expect(repo.resolverOperadorDestino('t-1', { id: ID_OP, telefono: null, numeroEmpleado: null })).rejects.toThrow(/No encontré a ese operador/);
  });

  it('un error de base NO se lee como «no existe»: lanza el error de la base', async () => {
    respuestas = [{ data: null, error: { message: 'conexión rota' } }];
    await expect(repo.resolverOperadorDestino('t-1', { id: ID_OP, telefono: null, numeroEmpleado: null })).rejects.toThrow(/conexión rota/);
  });

  it('operador DADO DE BAJA → se rechaza: no se manda un pago a quien ya no es chofer', async () => {
    respuestas = [{ data: [opFila({ activo: false })], error: null }];
    await expect(repo.resolverOperadorDestino('t-1', { id: ID_OP, telefono: null, numeroEmpleado: null })).rejects.toThrow(/dado de baja/);
  });

  it('dos formas que apuntan a choferes DISTINTOS se rechazan (no se adivina a quién va el pago)', async () => {
    const otro = '9b2504e0-4f89-41d3-9a0c-0305e82c3302';
    respuestas = [
      { data: [opFila()], error: null },
      { data: [opFila({ id: otro, telefono: '525599999999' })], error: null },
    ];
    await expect(repo.resolverOperadorDestino('t-1', { id: ID_OP, telefono: '525599999999', numeroEmpleado: null })).rejects.toThrow(/no coinciden entre sí/);
  });

  it('dos formas que coinciden en el mismo chofer pasan', async () => {
    respuestas = [{ data: [opFila()], error: null }, { data: [opFila()], error: null }];
    const o = await repo.resolverOperadorDestino('t-1', { id: ID_OP, telefono: '525512345678', numeroEmpleado: null });
    expect(o.id).toBe(ID_OP);
  });

  it('un número de empleado repetido (varios choferes) pide usar el id, no elige uno', async () => {
    respuestas = [{ data: [opFila(), opFila({ id: '9b2504e0-4f89-41d3-9a0c-0305e82c3302' })], error: null }];
    await expect(repo.resolverOperadorDestino('t-1', { id: null, telefono: null, numeroEmpleado: 'E-1' })).rejects.toThrow(/más de un operador/);
  });

  it('si UNA de las formas no encuentra a nadie, no se entrega por las otras', async () => {
    respuestas = [{ data: [opFila()], error: null }, { data: [], error: null }];
    await expect(repo.resolverOperadorDestino('t-1', { id: ID_OP, telefono: '525500000000', numeroEmpleado: null })).rejects.toThrow(/No encontré/);
  });
});

describe('lecturas: tenant siempre y errores que lanzan', () => {
  const fila = (p: Record<string, unknown> = {}) => ({
    id: 'l-1', tenant_id: 't-1', clave_externa: 'SAP-1', huella: 'h'.repeat(64), sistema_origen: 'SAP', operador_id: ID_OP,
    folios_viaje: ['V1'], viaje_ids: [], periodo_desde: '2026-09-01', periodo_hasta: '2026-09-07',
    conceptos: [{ clave: null, descripcion: 'x', tipo: 'percepcion', monto: 1 }], total: '1.00', moneda: 'MXN',
    pdf_ruta: 'p', pdf_origen: 'generado', estado: 'pendiente', via: null, generacion: 1, intentos: 0,
    proximo_intento_en: 'x', ultimo_error: null, wamid: null, enviada_en: null, acuse_tipo: null, acuse_en: null,
    created_at: '2026-09-08T00:00:00Z', operador: { nombre: 'Juan', telefono: '525512345678' }, ...p,
  });

  it('buscarPorClave filtra por tenant y clave, y mapea la fila (el total numeric llega como número)', async () => {
    respuestas = [{ data: fila(), error: null }];
    const l = await repo.buscarPorClave('t-1', 'SAP-1');
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(llamadas[0], 'clave_externa', 'SAP-1')).toBe(true);
    expect(l).toMatchObject({ total: 1, operadorNombre: 'Juan', operadorTelefono: '525512345678', estado: 'pendiente' });
  });

  it('buscarPorClave: no existe → null; error de base → LANZA (jamás «no existe»)', async () => {
    respuestas = [{ data: null, error: null }];
    expect(await repo.buscarPorClave('t-1', 'X')).toBeNull();
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.buscarPorClave('t-1', 'X')).rejects.toThrow(/boom/);
  });

  it('leerPorId filtra por tenant: un id de otra flota no devuelve nada', async () => {
    respuestas = [{ data: null, error: null }];
    expect(await repo.leerPorId('t-2', 'l-1')).toBeNull();
    expect(tieneEq(llamadas[0], 'tenant_id', 't-2')).toBe(true);
  });

  it('listar: tenant, filtros, orden estable y UNA fila de más para saber hayMas', async () => {
    respuestas = [{ data: [fila({ id: 'a' }), fila({ id: 'b' }), fila({ id: 'c' })], error: null, count: 3 }];
    const r = await repo.listarLiquidacionesExternas('t-1', { estado: 'fallida', operadorId: ID_OP, claveExterna: 'SAP-1', desde: '2026-09-01', hasta: '2026-09-30' }, 2, null, true);
    expect(r.filas.map((f) => f.id)).toEqual(['a', 'b']);
    expect(r.hayMas).toBe(true);
    expect(r.total).toBe(3);
    const ops = llamadas[0].ops;
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(llamadas[0], 'estado', 'fallida')).toBe(true);
    expect(tieneEq(llamadas[0], 'operador_id', ID_OP)).toBe(true);
    expect(ops).toContainEqual(['range', 0, 2]);
    expect(ops.filter((o) => o[0] === 'order').map((o) => o[1])).toEqual(['created_at', 'id']);
    // los días son días de MÉXICO, no UTC
    expect(ops).toContainEqual(['gte', 'created_at', '2026-09-01T00:00:00-06:00']);
    expect(ops).toContainEqual(['lt', 'created_at', '2026-10-01T00:00:00-06:00']);
  });

  it('listar: `acuseTipo` filtra por la respuesta del chofer (no_coincide es lo primero que la oficina debe mirar)', async () => {
    respuestas = [{ data: [], error: null }];
    await repo.listarLiquidacionesExternas('t-1', { acuseTipo: 'no_coincide' }, 10, null, false);
    expect(tieneEq(llamadas[0], 'acuse_tipo', 'no_coincide')).toBe(true);
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
  });

  it('listar: el cursor es keyset (created_at, id), no una posición', async () => {
    respuestas = [{ data: [], error: null }];
    await repo.listarLiquidacionesExternas('t-1', {}, 10, { creadoEn: '2026-09-08T00:00:00Z', id: 'z' }, false);
    const or = llamadas[0].ops.find((o) => o[0] === 'or')![1] as string;
    expect(or).toBe('created_at.lt.2026-09-08T00:00:00Z,and(created_at.eq.2026-09-08T00:00:00Z,id.lt.z)');
  });

  it('listar: sin fila de más → hayMas false; error de base → lanza', async () => {
    respuestas = [{ data: [fila()], error: null }];
    expect((await repo.listarLiquidacionesExternas('t-1', {}, 5, null, false)).hayMas).toBe(false);
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.listarLiquidacionesExternas('t-1', {}, 5, null, false)).rejects.toThrow(/boom/);
  });

  it('contarPorEstado: un conteo EXACTO por estado, y null (no 0) si no se pudo contar', async () => {
    respuestas = [
      { count: 4, error: null }, { count: 2, error: null }, { error: { message: 'x' }, count: null },
      { count: 0, error: null }, { count: 1, error: null },
    ];
    const c = await repo.contarPorEstado('t-1');
    const valores = Object.values(c);
    expect(valores).toContain(null);
    expect(valores).toContain(0);
    expect(llamadas.every((l) => tieneEq(l, 'tenant_id', 't-1'))).toBe(true);
    expect(llamadas.every((l) => l.ops.some((o) => o[0] === 'select' && (o[2] as { head?: boolean })?.head === true))).toBe(true);
  });

  it('resolverViajeIds: con tenant; sin folios no consulta; error lanza', async () => {
    expect(await repo.resolverViajeIds('t-1', [])).toEqual([]);
    expect(llamadas).toHaveLength(0);
    respuestas = [{ data: [{ id: 'v1' }], error: null }];
    expect(await repo.resolverViajeIds('t-1', ['VJ-1'])).toEqual(['v1']);
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.resolverViajeIds('t-1', ['VJ-1'])).rejects.toThrow(/boom/);
  });
});

describe('escrituras', () => {
  it('transicionar: CONDICIONAL al estado y al tenant; devuelve si aplicó', async () => {
    respuestas = [{ data: [{ id: 'l-1' }], error: null }];
    expect(await repo.transicionar('t-1', 'l-1', ['pendiente', 'en_cola'], { estado: 'enviada' })).toBe(true);
    const l = llamadas[0];
    expect(tieneEq(l, 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(l, 'id', 'l-1')).toBe(true);
    expect(l.ops).toContainEqual(['in', 'estado', ['pendiente', 'en_cola']]);
    respuestas = [{ data: [], error: null }];
    expect(await repo.transicionar('t-1', 'l-1', ['pendiente'], { estado: 'enviada' })).toBe(false);
  });

  it('transicionar: un error de base LANZA (no se reporta como «no aplicó»)', async () => {
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.transicionar('t-1', 'l-1', ['pendiente'], {})).rejects.toThrow(/boom/);
  });

  it('insertar: lleva el tenant, las cifras tal cual y el chofer resuelto; el choque del unique se propaga con su nombre', async () => {
    respuestas = [{ data: null, error: { message: 'duplicate key value violates unique constraint "liquidacion_externa_clave_unica"' } }];
    const datos = {
      claveExterna: 'SAP-1', sistemaOrigen: 'SAP', operador: { id: null, telefono: null, numeroEmpleado: null }, viajes: ['V1'],
      periodo: { desde: '2026-09-01', hasta: '2026-09-07' }, conceptos: [], total: 1, moneda: 'MXN' as const, pdf: null,
    };
    await expect(repo.insertarLiquidacionExterna({
      tenantId: 't-1', datos, huella: 'h'.repeat(64), operadorId: ID_OP, viajeIds: [], pdfRuta: 'p', pdfOrigen: 'generado', pdfSha256: null,
    })).rejects.toThrow(/liquidacion_externa_clave_unica/);
    const ins = llamadas[0].ops.find((o) => o[0] === 'insert')![1] as Record<string, unknown>;
    expect(ins).toMatchObject({ tenant_id: 't-1', clave_externa: 'SAP-1', operador_id: ID_OP, total: 1, moneda: 'MXN' });
  });

  it('registrarEvento: la bitácora que falla NO lanza (el estado ya cambió), pero queda en el log', async () => {
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.registrarEvento('t-1', 'l-1', 'enviada', { a: 1 })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('liqext.evento_sin_escribir', expect.objectContaining({ tipo: 'enviada' }));
    expect(llamadas[0].ops.find((o) => o[0] === 'insert')![1]).toMatchObject({ tenant_id: 't-1', liquidacion_externa_id: 'l-1', tipo: 'enviada' });
  });

  it('eventosDe: con tenant, en orden de inserción', async () => {
    respuestas = [{ data: [{ tipo: 'recibida', detalle: null, created_at: 'x' }], error: null }];
    const e = await repo.eventosDe('t-1', 'l-1');
    expect(e).toEqual([{ tipo: 'recibida', detalle: {}, creadoEn: 'x' }]);
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
  });
});

describe('Storage: el bucket privado `liquidaciones`', () => {
  it('sube como application/pdf con upsert (el reintento escribe lo mismo, en la ruta direccionada por contenido)', async () => {
    await repo.subirPdfExterno('t-1/externas/x.pdf', new Uint8Array([1, 2, 3]));
    expect(upload).toHaveBeenCalledWith('t-1/externas/x.pdf', expect.any(Buffer), { contentType: 'application/pdf', upsert: true });
    expect(bucketsUsados).toEqual(['liquidaciones']);
  });

  it('si Storage falla, LANZA (no se inserta una liquidación sin PDF)', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'cuota' } });
    await expect(repo.subirPdfExterno('x', new Uint8Array([1]))).rejects.toThrow(/cuota/);
  });

  it('firma con el TTL pedido y con nombre de descarga opcional', async () => {
    await repo.firmarPdfExterno('x.pdf', 86400);
    expect(createSignedUrl).toHaveBeenLastCalledWith('x.pdf', 86400, undefined);
    await repo.firmarPdfExterno('x.pdf', 60, 'liq.pdf');
    expect(createSignedUrl).toHaveBeenLastCalledWith('x.pdf', 60, { download: 'liq.pdf' });
  });

  it('si no hay URL firmada lanza: un mensaje sin documento diría «el detalle va en el PDF» sin PDF', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'no existe' } });
    await expect(repo.firmarPdfExterno('x.pdf', 60)).rejects.toThrow(/no existe/);
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: '' }, error: null });
    await expect(repo.firmarPdfExterno('x.pdf', 60)).rejects.toThrow(/sin URL/);
  });
});

describe('razón social y cola de WhatsApp', () => {
  it('leerRazonSocial: la de la flota; sin ella o ante un error, null (un nombre NUNCA se inventa)', async () => {
    respuestas = [{ data: { razon_social: '  Transportes Ejemplo SA  ' }, error: null }];
    expect(await repo.leerRazonSocial('t-1')).toBe('Transportes Ejemplo SA');
    expect(llamadas[0].tabla).toBe('tenant');
    respuestas = [{ data: { razon_social: '   ' }, error: null }];
    expect(await repo.leerRazonSocial('t-1')).toBeNull();
    respuestas = [{ data: null, error: null }];
    expect(await repo.leerRazonSocial('t-1')).toBeNull();
    respuestas = [{ data: null, error: { message: 'boom' } }];
    expect(await repo.leerRazonSocial('t-1')).toBeNull();
  });

  it('leerFilasOutbox: por llaves de deduplicación, indexado por llave; un error LANZA', async () => {
    respuestas = [{ data: [{ dedupe_key: 'k1', estado: 'sent', provider_message_id: 'w', ultimo_error: null }], error: null }];
    const m = await repo.leerFilasOutbox(['k1', 'k2']);
    expect(llamadas[0].tabla).toBe('wa_outbox');
    expect(llamadas[0].ops).toContainEqual(['in', 'dedupe_key', ['k1', 'k2']]);
    expect(m.get('k1')?.estado).toBe('sent');
    expect(m.has('k2')).toBe(false);
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.leerFilasOutbox(['k1'])).rejects.toThrow(/boom/);
  });

  it('contarNoCoincide: acusadas con acuse no_coincide, del tenant; null (no 0) si no se pudo contar', async () => {
    respuestas = [{ count: 3, error: null }];
    expect(await repo.contarNoCoincide('t-1')).toBe(3);
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(llamadas[0], 'acuse_tipo', 'no_coincide')).toBe(true);
    expect(tieneEq(llamadas[0], 'estado', 'acusada')).toBe(true);
    respuestas = [{ count: null, error: { message: 'x' } }];
    expect(await repo.contarNoCoincide('t-1')).toBeNull();
  });
});

describe('«No coincide» atómico: la transición condicional sobre el acuse', () => {
  it('transicionar con `acuseDistintoDe` agrega la condición «sin acuse o con otro tipo» (la segunda entrega del botón no aplica)', async () => {
    respuestas = [{ data: [{ id: 'l-1' }], error: null }];
    await repo.transicionar('t-1', 'l-1', ['enviada', 'acusada'], { estado: 'acusada', acuse_tipo: 'no_coincide' }, { acuseDistintoDe: 'no_coincide' });
    expect(llamadas[0].ops).toContainEqual(['or', 'acuse_tipo.is.null,acuse_tipo.neq.no_coincide']);
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
  });

  it('sin la opción no agrega ninguna condición de acuse', async () => {
    respuestas = [{ data: [], error: null }];
    await repo.transicionar('t-1', 'l-1', ['pendiente'], { estado: 'enviada' });
    expect(llamadas[0].ops.some((o) => o[0] === 'or')).toBe(false);
  });
});

describe('el aviso de discrepancia (0643/0644): RPC con tenant, y base sin migrar', () => {
  const ausente = { data: null, error: { code: '42883', message: 'function public.registrar_acuse_no_coincide does not exist' } };

  it('registrarNoCoincideAtomico: manda tenant, liquidación, operador y hora; devuelve el ciclo, o null si no la ganó', async () => {
    respuestas = [{ data: 2, error: null }];
    expect(await repo.registrarNoCoincideAtomico('t-1', 'l-1', 'op-1', '2026-10-02T10:00:00Z')).toEqual({ ciclo: 2 });
    expect(rpcs[0]).toEqual({ fn: 'registrar_acuse_no_coincide', args: { p_tenant: 't-1', p_liquidacion: 'l-1', p_operador: 'op-1', p_ahora: '2026-10-02T10:00:00Z' } });
    respuestas = [{ data: null, error: null }];
    expect(await repo.registrarNoCoincideAtomico('t-1', 'l-1', 'op-1', 'x')).toEqual({ ciclo: null });
  });

  it('registrarNoCoincideAtomico: sin la RPC (base sin 0644) → \'sin_rpc\'; otro error LANZA (no se da por acusada)', async () => {
    respuestas = [ausente];
    expect(await repo.registrarNoCoincideAtomico('t-1', 'l-1', 'op-1', 'x')).toBe('sin_rpc');
    respuestas = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    await expect(repo.registrarNoCoincideAtomico('t-1', 'l-1', 'op-1', 'x')).rejects.toThrow(/boom/);
  });

  it('reclamar: token si le toca, null si no; un error LANZA (sin saber si otro lo manda, no se manda)', async () => {
    respuestas = [{ data: 'tok-1', error: null }];
    expect(await repo.reclamarAvisoDiscrepancia('t-1', 'l-1', 1, 'x')).toEqual({ token: 'tok-1' });
    expect(rpcs[0].args).toMatchObject({ p_tenant: 't-1', p_liquidacion: 'l-1', p_ciclo: 1 });
    respuestas = [{ data: null, error: null }];
    expect(await repo.reclamarAvisoDiscrepancia('t-1', 'l-1', 1, 'x')).toBeNull();
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.reclamarAvisoDiscrepancia('t-1', 'l-1', 1, 'x')).rejects.toThrow(/boom/);
  });

  it('cerrar: manda el token, el resultado, los aceptados y el tope; NO lanza (devuelve null si no se pudo)', async () => {
    respuestas = [{ data: 'pendiente', error: null }];
    expect(await repo.cerrarAvisoDiscrepancia('t-1', 'l-1', 1, { token: 'tok' }, { resultado: 'reintentar', aceptados: ['5255'], error: 'e', proximoIso: 'p' }, 'x')).toBe('pendiente');
    expect(rpcs[0].args).toMatchObject({ p_claim: 'tok', p_resultado: 'reintentar', p_aceptados: ['5255'], p_error: 'e', p_proximo: 'p', p_max_intentos: repo.MAX_INTENTOS_AVISO });
    respuestas = [{ data: null, error: { message: 'boom' } }];
    expect(await repo.cerrarAvisoDiscrepancia('t-1', 'l-1', 1, { token: 'tok' }, { resultado: 'enviado', aceptados: [] }, 'x')).toBeNull();
  });

  it('rearmar: ciclo, null si ya salió, y \'sin_rpc\' sin la 0644', async () => {
    respuestas = [{ data: 1, error: null }];
    expect(await repo.rearmarAvisoDiscrepancia('t-1', 'l-1', 'x')).toEqual({ ciclo: 1 });
    respuestas = [{ data: null, error: null }];
    expect(await repo.rearmarAvisoDiscrepancia('t-1', 'l-1', 'x')).toEqual({ ciclo: null });
    respuestas = [ausente];
    expect(await repo.rearmarAvisoDiscrepancia('t-1', 'l-1', 'x')).toBe('sin_rpc');
  });

  it('leerAvisoDiscrepancia: con tenant, liquidación y ciclo; sin la tabla → null; otro error LANZA', async () => {
    respuestas = [{ data: { liquidacion_externa_id: 'l-1', tenant_id: 't-1', ciclo: 1, estado: 'pendiente', intentos: 2, proximo_intento_en: 'p', ultimo_error: null, telefonos_aceptados: ['5255'], tarea_id: null, enviado_en: null }, error: null }];
    expect(await repo.leerAvisoDiscrepancia('t-1', 'l-1', 1)).toMatchObject({ estado: 'pendiente', intentos: 2, telefonosAceptados: ['5255'] });
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(llamadas[0], 'liquidacion_externa_id', 'l-1')).toBe(true);
    respuestas = [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }];
    expect(await repo.leerAvisoDiscrepancia('t-1', 'l-1', 1)).toBeNull();
    respuestas = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    await expect(repo.leerAvisoDiscrepancia('t-1', 'l-1', 1)).rejects.toThrow(/boom/);
  });

  it('avisosDiscrepanciaDe: el más reciente de cada liquidación, con tenant; sin tabla o con error → null (no se inventa un estado)', async () => {
    const f = (id: string, ciclo: number, estado: string) => ({ liquidacion_externa_id: id, tenant_id: 't-1', ciclo, estado, intentos: 0, proximo_intento_en: 'p', ultimo_error: null, telefonos_aceptados: [], tarea_id: null, enviado_en: null });
    respuestas = [{ data: [f('l-1', 2, 'enviado'), f('l-1', 1, 'fallido'), f('l-2', 1, 'pendiente')], error: null }];
    const m = await repo.avisosDiscrepanciaDe('t-1', ['l-1', 'l-2']);
    expect(m?.get('l-1')?.ciclo).toBe(2);
    expect(m?.get('l-2')?.estado).toBe('pendiente');
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(llamadas[0].ops).toContainEqual(['in', 'liquidacion_externa_id', ['l-1', 'l-2']]);
    respuestas = [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }];
    expect(await repo.avisosDiscrepanciaDe('t-1', ['l-1'])).toBeNull();
    llamadas.length = 0;
    expect((await repo.avisosDiscrepanciaDe('t-1', []))?.size).toBe(0);
    expect(llamadas).toHaveLength(0); // sin ids no consulta
  });
});

describe('la tarea durable en la cola del orquestador (0650)', () => {
  const t = { resumen: 'Juan respondió «No coincide».', viajeFolio: 'VJ-1', viajeId: null };

  it('inserta destino liquidación, motivo diferencia_liquidacion y una llave por liquidación, con el tenant', async () => {
    respuestas = [{ data: { id: 'tarea-1' }, error: null }];
    expect(await repo.crearTareaDiferenciaLiquidacion('t-1', 'l-1', t)).toEqual({ estado: 'creada', id: 'tarea-1' });
    const ins = llamadas[0].ops.find((o) => o[0] === 'insert')![1] as Record<string, unknown>;
    expect(ins).toMatchObject({
      tenant_id: 't-1', destino: 'liquidacion', motivo: 'diferencia_liquidacion', viaje_folio: 'VJ-1', pedida_por_rol: 'sistema',
      dedupe_key: 'liquidacion|diferencia_liquidacion|liq:l-1',
    });
    expect(llamadas[0].tabla).toBe('orquestador_escalacion');
  });

  it('ya hay una abierta (índice único, 23505) → ya_abierta con la previa, de ESTA flota', async () => {
    respuestas = [{ data: null, error: { code: '23505', message: 'duplicate key' } }, { data: [{ id: 'previa-1' }], error: null }];
    expect(await repo.crearTareaDiferenciaLiquidacion('t-1', 'l-1', t)).toEqual({ estado: 'ya_abierta', id: 'previa-1' });
    expect(tieneEq(llamadas[1], 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(llamadas[1], 'estado', 'abierta')).toBe(true);
  });

  it('sin la 0650 → no_disponible; un folio inválido no viaja; otro error LANZA', async () => {
    respuestas = [{ data: null, error: { code: '42P01', message: 'relation "orquestador_escalacion" does not exist' } }];
    expect(await repo.crearTareaDiferenciaLiquidacion('t-1', 'l-1', t)).toEqual({ estado: 'no_disponible' });
    respuestas = [{ data: { id: 'x' }, error: null }];
    await repo.crearTareaDiferenciaLiquidacion('t-1', 'l-1', { ...t, viajeFolio: 'VJ 1; drop' });
    expect((llamadas[1].ops.find((o) => o[0] === 'insert')![1] as Record<string, unknown>).viaje_folio).toBeNull();
    respuestas = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    await expect(repo.crearTareaDiferenciaLiquidacion('t-1', 'l-1', t)).rejects.toThrow(/boom/);
  });
});

describe('teléfonos de la flota con o sin formato (0645)', () => {
  it('leerTelefonosFlota: copia y discrepancia por tenant, aunque la fila no traiga formato', async () => {
    respuestas = [{ data: { copia_telefonos: ['5255'], discrepancia_telefonos: null }, error: null }];
    expect(await repo.leerTelefonosFlota('t-1')).toEqual({ copia: ['5255'], discrepancia: [] });
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    respuestas = [{ data: null, error: null }];
    expect(await repo.leerTelefonosFlota('t-1')).toBeNull();
    respuestas = [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }];
    expect(await repo.leerTelefonosFlota('t-1')).toBeNull();
    respuestas = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    await expect(repo.leerTelefonosFlota('t-1')).rejects.toThrow(/boom/);
  });

  it('leerFormatoFlota: una fila SOLO de teléfonos (formato nulo) no es un formato', async () => {
    respuestas = [{ data: { formato: null, nombre_muestra: null, copia_telefonos: ['5255'], discrepancia_telefonos: [] }, error: null }];
    expect(await repo.leerFormatoFlota('t-1')).toBeNull();
  });

  it('guardarTelefonosFlota: si la fila existe actualiza SOLO los teléfonos (no toca el formato)', async () => {
    respuestas = [{ data: [{ tenant_id: 't-1' }], error: null }];
    await repo.guardarTelefonosFlota('t-1', { copia: ['5255'], discrepancia: [] }, 'dueño');
    const upd = llamadas[0].ops.find((o) => o[0] === 'update')![1] as Record<string, unknown>;
    expect(Object.keys(upd).sort()).toEqual(['actualizado_en', 'actualizado_por', 'copia_telefonos', 'discrepancia_telefonos']);
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(llamadas).toHaveLength(1);
  });

  it('guardarTelefonosFlota: sin fila la crea con formato nulo; sin teléfonos no crea nada; sin la 0645 lo dice en palabras', async () => {
    respuestas = [{ data: [], error: null }, { data: null, error: null }];
    await repo.guardarTelefonosFlota('t-1', { copia: [], discrepancia: ['5255'] }, 'dueño');
    expect((llamadas[1].ops.find((o) => o[0] === 'insert')![1] as Record<string, unknown>)).toMatchObject({ tenant_id: 't-1', formato: null, discrepancia_telefonos: ['5255'] });
    llamadas.length = 0;
    respuestas = [{ data: [], error: null }];
    await repo.guardarTelefonosFlota('t-1', { copia: [], discrepancia: [] }, 'dueño');
    expect(llamadas).toHaveLength(1); // solo el intento de actualizar
    respuestas = [{ data: [], error: null }, { data: null, error: { code: '23502', message: 'null value in column "formato"' } }];
    await expect(repo.guardarTelefonosFlota('t-1', { copia: ['5255'], discrepancia: [] }, 'dueño')).rejects.toThrow(/0645/);
  });

  it('borrarFormatoFlota: con teléfonos solo vacía el formato (se conservan); sin ellos, o sin la 0645, borra la fila', async () => {
    respuestas = [{ data: { copia_telefonos: ['5255'], discrepancia_telefonos: [] }, error: null }, { data: null, error: null }];
    await repo.borrarFormatoFlota('t-1');
    const upd = llamadas[1].ops.find((o) => o[0] === 'update')![1] as Record<string, unknown>;
    expect(upd).toMatchObject({ formato: null, nombre_muestra: null });
    expect(llamadas.some((l) => l.ops.some((o) => o[0] === 'delete'))).toBe(false);

    llamadas.length = 0;
    respuestas = [{ data: { copia_telefonos: [], discrepancia_telefonos: [] }, error: null }, { data: null, error: null }];
    await repo.borrarFormatoFlota('t-1');
    expect(llamadas[1].ops.some((o) => o[0] === 'delete')).toBe(true);

    llamadas.length = 0;
    respuestas = [{ data: { copia_telefonos: ['5255'], discrepancia_telefonos: [] }, error: null }, { data: null, error: { code: '23502', message: 'not null' } }, { data: null, error: null }];
    await repo.borrarFormatoFlota('t-1');
    expect(llamadas[2].ops.some((o) => o[0] === 'delete')).toBe(true); // base sin la 0645: como antes
  });
});
