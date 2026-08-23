import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · A20 — las dos reglas que impiden cobrar contra nada vivían
// en dos `if` que ninguna prueba tocaba. `evaluarAbono` (pura) SÍ estaba
// probada; lo que no estaba probado era el CABLEADO: ¿registrarPago consulta
// el veredicto? ¿cancelarFactura cuenta los pagos antes de cancelar? Borrando
// las dos guardas la suite quedaba verde y una factura de $11,600 con $10,000
// pagados aceptaba un abono de $2,000.
//
// No es "probar el mock": la base es un doble mínimo y lo que se afirma es
// qué escrituras NO ocurren cuando la regla dice que no.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null };
const respuestas = new Map<string, Resp[]>();
const escrituras: Array<{ tabla: string; op: 'insert' | 'update'; fila: Record<string, unknown>; filtros: Array<[string, unknown]> }> = [];

function builder(tabla: string) {
  const filtros: Array<[string, unknown]> = [];
  let pendiente: { op: 'insert' | 'update'; fila: Record<string, unknown> } | null = null;
  const responder = () => {
    if (pendiente) escrituras.push({ tabla, ...pendiente, filtros });
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: null, error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return b; },
    in: () => b,
    maybeSingle: () => b,
    single: () => b,
    insert: (fila: Record<string, unknown>) => { pendiente = { op: 'insert', fila }; return b; },
    update: (fila: Record<string, unknown>) => { pendiente = { op: 'update', fila }; return b; },
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));

const { registrarPago, cancelarFactura, crearFactura, marcarEmitida } = await import('./facturacion_escritura');
const { DatoInvalido } = await import('./errores');

const T = 't-1';
const FACTURA = 'ad662d33-6934-459c-a128-bdf0393f0f44';
const pago = (monto: number) => ({ facturaId: FACTURA, fecha: '2026-08-20', monto, metodo: 'transferencia', referencia: null });
const escribioEn = (tabla: string) => escrituras.filter((e) => e.tabla === tabla);

beforeEach(() => { respuestas.clear(); escrituras.length = 0; rpc.mockReset(); });

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · DAT-05 — el veredicto se mudó a la base, y por eso este
// bloque cambió de forma.
//
// Antes se comprobaba que `registrarPago` consultara `evaluarAbono` y no
// escribiera cuando el veredicto decía que no. Eso ya no se puede probar aquí
// —ni tiene sentido—: la decisión ocurre DENTRO de `registrar_pago_tx`, con la
// factura tomada `for update`, que es lo único que impide que dos abonos
// simultáneos vean los dos el mismo saldo. Las cuatro reglas viven ahora en
// SQL y se prueban contra Postgres (bloque 131 de verificaciones.sql).
//
// Lo que SÍ es de este lado, y es lo que se prueba: que el rechazo de la base
// llegue traducido a las palabras del contralor con la cifra correcta, que una
// CAÍDA no se lea como un rechazo de negocio, y que ninguna escritura suelta
// haya sobrevivido a la mudanza.
// ═══════════════════════════════════════════════════════════════════════════
describe('registrarPago — la decisión la toma la base; aquí se traduce', () => {
  it('el pago que entra: un solo RPC con los seis parámetros, y la bitácora con el id que devolvió la base', async () => {
    rpc.mockResolvedValue({ data: { pago_id: 'pago-1', saldada: true, saldo_previo: 1600 }, error: null });

    await registrarPago(T, pago(1600), { id: 'u-conta' });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('registrar_pago_tx');
    expect(rpc.mock.calls[0][1]).toEqual({
      p_tenant: T, p_factura: FACTURA, p_fecha: '2026-08-20',
      p_monto: 1600, p_metodo: 'transferencia', p_referencia: null,
    });
    expect(escribioEn('bitacora_auditoria')[0].fila).toMatchObject({
      accion: 'pago.registrado', actor_id: 'u-conta', entidad_id: 'pago-1',
    });
  });

  it('NINGUNA escritura suelta sobrevivió: ni el insert del pago ni el update del estatus salen de aquí', async () => {
    // El estatus `pagada` se escribía aquí, en un segundo statement cuyo fallo
    // solo se podía loguear ("el pago quedó pero la factura no pasó a pagada").
    // Ese estado ya no existe: entra en la misma transacción que el pago.
    rpc.mockResolvedValue({ data: { pago_id: 'pago-1', saldada: true }, error: null });
    await registrarPago(T, pago(1600));
    expect(escribioEn('pago_recibido')).toEqual([]);
    expect(escribioEn('factura_emitida')).toEqual([]);
  });

  it('el sobrepago (CU011) le dice al contralor el saldo exacto que sí cabe ($1,600), y no anota nada', async () => {
    // El caso de la auditoría: $11,600 con $10,000 pagados NO acepta $2,000.
    rpc.mockResolvedValue({ data: null, error: { code: 'CU011', message: 'motivo=sobrepago saldo=1600.00' } });

    const err = await registrarPago(T, pago(2000)).catch((e) => e);
    expect(err).toBeInstanceOf(DatoInvalido);
    expect(err.message).toMatch(/1,600/);
    expect(err.message).toMatch(/nota de crédito/);
    expect(escrituras).toEqual([]);
  });

  it('los otros tres motivos llegan con SU texto, no con uno genérico', async () => {
    for (const [motivo, esperado] of [
      ['cancelada', /cancelada/],
      ['borrador', /borrador/],
      ['pagada', /ya está saldada/],
    ] as const) {
      rpc.mockResolvedValue({ data: null, error: { code: 'CU011', message: `motivo=${motivo} saldo=0` } });
      await expect(registrarPago(T, pago(100))).rejects.toThrow(esperado);
    }
  });

  it('una factura de OTRA flota (CU010) se rechaza sin escribir', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'CU010', message: 'factura fuera de la flota' } });
    await expect(registrarPago(T, pago(100))).rejects.toThrow(/no está en tu flota/);
    expect(escrituras).toEqual([]);
  });

  it('la base caída NO se lee como rechazo de negocio: Error, no DatoInvalido', async () => {
    // Es la misma regla de siempre en este archivo, ahora sobre el error del
    // RPC: un timeout de `acotada` llega SIN code, y tratarlo como "la factura
    // no admite el pago" le mentiría al contralor sobre su propia cartera.
    rpc.mockResolvedValue({ data: null, error: { message: 'sin respuesta en 8000 ms (tope de consulta)' } });
    const err = await registrarPago(T, pago(100)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DatoInvalido);
    expect(escrituras).toEqual([]);
  });

  it('un RPC que dice "ok" sin id de pago es un error, no un pago que se da por bueno', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(registrarPago(T, pago(100))).rejects.toThrow(/no devolvió el id/);
    expect(escribioEn('bitacora_auditoria')).toEqual([]);
  });
});

describe('cancelarFactura — cuenta los pagos ANTES de cancelar', () => {
  it('con un pago encima NO cancela: el dinero ya contado se aclara primero', async () => {
    respuestas.set('pago_recibido', [{ data: null, error: null, count: 1 }]);
    await expect(cancelarFactura(T, FACTURA)).rejects.toThrow(/pagos registrados/);
    expect(escribioEn('factura_emitida')).toEqual([]);
    expect(escribioEn('bitacora_auditoria')).toEqual([]);
  });

  it('sin pagos cancela, acotado a tenant, y anota la bitácora', async () => {
    respuestas.set('pago_recibido', [{ data: null, error: null, count: 0 }]);
    respuestas.set('factura_emitida', [{ data: [{ id: FACTURA }], error: null }]);
    await cancelarFactura(T, FACTURA, { id: 'u-1' });
    const upd = escribioEn('factura_emitida');
    expect(upd).toHaveLength(1);
    expect(upd[0].fila).toEqual({ estatus: 'cancelada' });
    expect(upd[0].filtros).toEqual(expect.arrayContaining([['tenant_id', T], ['id', FACTURA]]));
    expect(escribioEn('bitacora_auditoria')[0].fila).toMatchObject({ accion: 'factura.cancelada' });
  });

  it('si el conteo de pagos falla, NO se cancela a ciegas', async () => {
    respuestas.set('pago_recibido', [{ data: null, error: { message: 'caída' }, count: null }]);
    await expect(cancelarFactura(T, FACTURA)).rejects.toThrow(/no se pudieron contar/);
    expect(escribioEn('factura_emitida')).toEqual([]);
  });

  it('ya cancelada / de otra flota: el update toca 0 filas y se dice', async () => {
    respuestas.set('pago_recibido', [{ data: null, error: null, count: 0 }]);
    respuestas.set('factura_emitida', [{ data: [], error: null }]);
    await expect(cancelarFactura(T, FACTURA)).rejects.toThrow(/no se pudo cancelar/);
    expect(escribioEn('bitacora_auditoria')).toEqual([]);
  });

  it('un id que no es uuid se rechaza antes de tocar la base', async () => {
    await expect(cancelarFactura(T, 'x')).rejects.toThrow(DatoInvalido);
    expect(escrituras).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RES-22 (auditoría prod, mig. 0166) — LA SERIE LLEGA A LA BASE, Y EL CHOQUE
// DE FOLIO DICE CONTRA QUÉ SE COMPARÓ.
//
// La validación pura (normalizar, rechazar) se prueba en
// `facturacion_escritura.test.ts` y la garantía del índice contra Postgres en
// el bloque 138 de `verificaciones.sql`. Lo que falta —y es justo lo que se
// rompe callado— es el CABLEADO: que `serie` viaje en el INSERT (borrarla de
// ahí dejaría la suite verde y todas las facturas sin serie en producción) y
// que el 23505 se traduzca con la llave completa.
// ═══════════════════════════════════════════════════════════════════════════

const CLIENTE = '11111111-2222-3333-4444-555555555555';
const factura = (over: Record<string, unknown> = {}) => ({
  clienteId: CLIENTE, fecha: '2026-01-02', subtotal: 10000, iva: 1600, total: 11600,
  serie: 'A' as string | null, folio: '1' as string | null, cfdiUuid: null,
  estatus: 'borrador' as const, viajeIds: [] as string[], ...over,
});

describe('crearFactura — la serie viaja con el folio (RES-22)', () => {
  it('el INSERT lleva `serie`, y en NULL cuando la flota no usa series', async () => {
    respuestas.set('cliente', [{ data: { id: CLIENTE, dias_credito: null }, error: null }]);
    respuestas.set('factura_emitida', [{ data: { id: FACTURA }, error: null }]);
    await crearFactura(T, factura({ serie: null }));
    const ins = escribioEn('factura_emitida');
    expect(ins).toHaveLength(1);
    expect(ins[0].fila).toMatchObject({ serie: null, folio: '1', tenant_id: T });
  });

  it('y con serie la manda tal como se capturó', async () => {
    respuestas.set('cliente', [{ data: { id: CLIENTE, dias_credito: null }, error: null }]);
    respuestas.set('factura_emitida', [{ data: { id: FACTURA }, error: null }]);
    await crearFactura(T, factura({ serie: 'A' }));
    expect(escribioEn('factura_emitida')[0].fila).toMatchObject({ serie: 'A' });
  });

  it('el 23505 del consecutivo se cuenta con serie, folio y ejercicio', async () => {
    respuestas.set('cliente', [{ data: { id: CLIENTE, dias_credito: null }, error: null }]);
    respuestas.set('factura_emitida', [{
      data: null,
      error: { message: 'duplicate key value violates unique constraint "factura_folio_unico"' },
    }]);
    const err = await crearFactura(T, factura({ serie: 'A', folio: '1', fecha: '2026-01-02' })).catch((e) => e);
    expect(err).toBeInstanceOf(DatoInvalido);
    expect(err.message).toContain('serie «A»');
    expect(err.message).toContain('ejercicio 2026');
    expect(err.message).toContain('«1»');
  });

  it('el CHECK de la serie se traduce, no sale como error crudo de Postgres', async () => {
    respuestas.set('cliente', [{ data: { id: CLIENTE, dias_credito: null }, error: null }]);
    respuestas.set('factura_emitida', [{
      data: null,
      error: { message: 'new row violates check constraint "factura_serie_btrim"' },
    }]);
    const err = await crearFactura(T, factura()).catch((e) => e);
    expect(err).toBeInstanceOf(DatoInvalido);
    expect(err.message).toMatch(/serie no puede ir vacía/);
  });
});

describe('marcarEmitida — la serie sólo se toca si de verdad viene', () => {
  it('sin serie en el sello, el UPDATE no la nombra: no borra la del borrador', async () => {
    respuestas.set('factura_emitida', [{ data: [{ id: FACTURA }], error: null }]);
    await marcarEmitida(T, FACTURA, { folio: '1', cfdiUuid: FACTURA });
    const upd = escribioEn('factura_emitida');
    expect(upd).toHaveLength(1);
    expect(Object.keys(upd[0].fila)).not.toContain('serie');
  });

  it('con serie en el sello, la escribe normalizada (el CFDI manda)', async () => {
    respuestas.set('factura_emitida', [{ data: [{ id: FACTURA }], error: null }]);
    await marcarEmitida(T, FACTURA, { serie: '  A  ', folio: '1', cfdiUuid: FACTURA });
    expect(escribioEn('factura_emitida')[0].fila).toMatchObject({ serie: 'A' });
  });

  it('con serie vacía la BORRA a propósito: el CFDI se timbró sin serie', async () => {
    respuestas.set('factura_emitida', [{ data: [{ id: FACTURA }], error: null }]);
    await marcarEmitida(T, FACTURA, { serie: '', folio: '1', cfdiUuid: FACTURA });
    expect(escribioEn('factura_emitida')[0].fila).toMatchObject({ serie: null });
  });

  it('el choque al sellar NO inventa el ejercicio: la fecha no viaja en el sello', async () => {
    respuestas.set('factura_emitida', [{
      data: null,
      error: { message: 'duplicate key value violates unique constraint "factura_folio_unico"' },
    }]);
    const err = await marcarEmitida(T, FACTURA, { folio: '1', cfdiUuid: FACTURA }).catch((e) => e);
    expect(err).toBeInstanceOf(DatoInvalido);
    expect(err.message).toContain('ese mismo ejercicio');
    expect(err.message).not.toMatch(/ejercicio \d{4}/);
  });
});
