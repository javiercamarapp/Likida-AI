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
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));

const { registrarPago, cancelarFactura } = await import('./facturacion_escritura');
const { DatoInvalido } = await import('./errores');

const T = 't-1';
const FACTURA = 'ad662d33-6934-459c-a128-bdf0393f0f44';
const pago = (monto: number) => ({ facturaId: FACTURA, fecha: '2026-08-20', monto, metodo: 'transferencia', referencia: null });
const escribioEn = (tabla: string) => escrituras.filter((e) => e.tabla === tabla);

beforeEach(() => { respuestas.clear(); escrituras.length = 0; });

describe('registrarPago — consulta el veredicto de evaluarAbono antes de escribir', () => {
  it('$11,600 emitida con $10,000 pagados RECHAZA un abono de $2,000: ni pago ni estatus se escriben', async () => {
    respuestas.set('factura_emitida', [{ data: { id: FACTURA, total: 11600, estatus: 'emitida' }, error: null }]);
    respuestas.set('pago_recibido', [{ data: [{ monto: 10000 }], error: null }]);

    await expect(registrarPago(T, pago(2000))).rejects.toThrow(DatoInvalido);
    expect(escribioEn('pago_recibido')).toEqual([]);
    expect(escribioEn('factura_emitida')).toEqual([]);
    expect(escribioEn('bitacora_auditoria')).toEqual([]);
  });

  it('el rechazo le dice al contador el saldo exacto que sí cabe ($1,600)', async () => {
    respuestas.set('factura_emitida', [{ data: { id: FACTURA, total: 11600, estatus: 'emitida' }, error: null }]);
    respuestas.set('pago_recibido', [{ data: [{ monto: 10000 }], error: null }]);
    await expect(registrarPago(T, pago(2000))).rejects.toThrow(/1,600/);
  });

  it('el abono que SALDA ($1,600 exactos) inserta el pago y pasa la factura a `pagada` acotado a tenant y estatus emitida', async () => {
    respuestas.set('factura_emitida', [
      { data: { id: FACTURA, total: 11600, estatus: 'emitida' }, error: null },
      { data: [{ id: FACTURA }], error: null }, // el update
    ]);
    respuestas.set('pago_recibido', [
      { data: [{ monto: 10000 }], error: null },
      { data: { id: 'pago-1' }, error: null }, // el insert
    ]);
    await registrarPago(T, pago(1600), { id: 'u-conta' });

    const ins = escribioEn('pago_recibido');
    expect(ins).toHaveLength(1);
    expect(ins[0].fila).toMatchObject({ tenant_id: T, factura_id: FACTURA, monto: 1600 });

    const upd = escribioEn('factura_emitida');
    expect(upd).toHaveLength(1);
    expect(upd[0].fila).toEqual({ estatus: 'pagada' });
    expect(upd[0].filtros).toEqual(expect.arrayContaining([['tenant_id', T], ['estatus', 'emitida'], ['id', FACTURA]]));

    expect(escribioEn('bitacora_auditoria')[0].fila).toMatchObject({ accion: 'pago.registrado', actor_id: 'u-conta' });
  });

  it('un abono parcial ($5,000 sobre $11,600) inserta el pago y NO toca el estatus', async () => {
    respuestas.set('factura_emitida', [{ data: { id: FACTURA, total: 11600, estatus: 'emitida' }, error: null }]);
    respuestas.set('pago_recibido', [{ data: [], error: null }, { data: { id: 'pago-2' }, error: null }]);
    await registrarPago(T, pago(5000));
    expect(escribioEn('pago_recibido')).toHaveLength(1);
    expect(escribioEn('factura_emitida')).toEqual([]);
  });

  it('una factura de OTRA flota (la lectura acotada a tenant no la encuentra) se rechaza sin escribir', async () => {
    respuestas.set('factura_emitida', [{ data: null, error: null }]);
    await expect(registrarPago(T, pago(100))).rejects.toThrow(/no está en tu flota/);
    expect(escrituras).toEqual([]);
  });

  it('la base caída al leer la factura NO se lee como "no existe": lanza Error, no DatoInvalido', async () => {
    respuestas.set('factura_emitida', [{ data: null, error: { message: 'timeout' } }]);
    const err = await registrarPago(T, pago(100)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DatoInvalido);
    expect(escrituras).toEqual([]);
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
