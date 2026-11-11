// Fija, ANTES de migrar la pantalla, lo que hacen las acciones que emiten, cancelan y liberan un CFDI: las dos puertas (área y verbo),
// el segundo factor, el mapeo PUE/PPD a forma de pago, y que un fallo del PAC jamás se dé por «no emitido».
import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  ctx: {} as Record<string, unknown>,
  sesion: { tenantId: 't-1', rol: 'contador', userId: 'u-1' } as null | Record<string, string>,
  ve: true, timbra: true, paso: null as string | null,
  timbrarViaje: vi.fn(), liberar: vi.fn(), cancelar: vi.fn(), confirmar: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't-1', rol: 'contador', userId: 'u-1' }) }));
vi.mock('@/lib/auth/tenant-atado', () => ({ resolverTenantAtadoAccion: async () => d.sesion, MENSAJE_FLOTA_CAMBIO: 'cambio de flota' }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => d.ve }));
vi.mock('@/lib/auth/permisos', () => ({ puedeTimbrar: () => d.timbra }));
vi.mock('@/lib/auth/stepup', () => ({ exigirStepUpAccion: async () => d.paso }));
vi.mock('@/lib/likida/carta_porte_cfdi', () => ({ armarCfdiTimbrable: () => ({ ok: true, subTotal: 1000, iva: 160, total: 1160, retencionIva: null }) }));
vi.mock('@/lib/likida/carta_porte', () => ({ generarIdCcp: () => 'id' }));
vi.mock('@/lib/likida/carta_porte_cancelacion', () => ({
  solicitarCancelacionTimbre: (...a: unknown[]) => d.cancelar(...a), confirmarCancelacionTimbre: (...a: unknown[]) => d.confirmar(...a),
}));
vi.mock('@/lib/likida/administracion', () => ({ mensajeParaPantalla: (e: Error) => `ERR ${e.message}` }));
vi.mock('@/lib/likida/carta_porte_timbre', () => ({
  leerContextoTimbre: async () => d.ctx,
  guardarReceptorFiscal: vi.fn(),
  timbrarViaje: (...a: unknown[]) => d.timbrarViaje(...a),
  liberarReservaTimbre: (...a: unknown[]) => d.liberar(...a),
  motivoDeReservaViva: () => 'en curso', MINUTOS_MIN_LIBERAR_RESERVA: 30,
}));

import { SeccionTimbrado } from './timbrar';

type Acc = (previo: null, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accion(nodo: ReactNode, boton: RegExp): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map((n) => accion(n, boton)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (typeof nodo.props.boton === 'string' && boton.test(nodo.props.boton)) return nodo.props.accion as Acc;
  return accion(nodo.props.children as ReactNode, boton);
}
function prop(nodo: ReactNode, nombre: string): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map((n) => prop(n, nombre)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (typeof nodo.props[nombre] === 'function') return nodo.props[nombre] as Acc;
  return prop(nodo.props.children as ReactNode, nombre);
}
const V = { viajeId: 'v-1' } as never;
const base = () => ({
  emisor: { modo: 'sandbox' }, receptor: {}, clienteId: 'c-1', ingresoFlete: 1000, timbreVigente: null, reservaPendiente: null,
  pac: { configurado: true, proveedor: 'sw', pareceSandbox: true },
});
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const pintar = async () => SeccionTimbrado({ v: V, searchParams: {} }) as Promise<ReactNode>;

beforeEach(() => {
  vi.clearAllMocks();
  d.ctx = base(); d.sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-1' }; d.ve = true; d.timbra = true; d.paso = null;
  d.timbrarViaje.mockResolvedValue({ ok: true, uuid: 'U-1', modo: 'sandbox', yaExistia: false });
});

describe('timbrar', () => {
  it('cambio de flota, sin ruta o sin el verbo de timbrar: no llama al PAC', async () => {
    const a = (await accion(await pintar(), /^Timbrar/))!;
    d.sesion = null;
    expect((await a(null, fd({}))).error).toBe('cambio de flota');
    d.sesion = { tenantId: 't-1', rol: 'encargado', userId: 'u-1' }; d.ve = false;
    expect((await a(null, fd({}))).error).toMatch(/no ve el timbrado/);
    d.ve = true; d.timbra = false;
    expect((await a(null, fd({}))).error).toMatch(/no puede timbrar/);
    expect(d.timbrarViaje).not.toHaveBeenCalled();
  });
  it('el segundo factor pendiente corta antes de emitir', async () => {
    const a = (await accion(await pintar(), /^Timbrar/))!;
    d.paso = 'Falta el segundo factor.';
    expect((await a(null, fd({ metodoPago: 'PUE' }))).error).toBe('Falta el segundo factor.');
    expect(d.timbrarViaje).not.toHaveBeenCalled();
  });
  it('PPD fuerza forma 99; PUE usa la forma capturada', async () => {
    const a = (await accion(await pintar(), /^Timbrar/))!;
    await a(null, fd({ metodoPago: 'PPD', formaPago: '03', fechaLlegadaEstimada: '2026-11-11T10:00' }));
    expect(d.timbrarViaje).toHaveBeenLastCalledWith('t-1', 'v-1', { metodoPago: 'PPD', formaPago: '99', fechaLlegadaEstimada: '2026-11-11T10:00' }, { id: 'u-1' });
    await a(null, fd({ metodoPago: 'PUE', formaPago: '03' }));
    expect(d.timbrarViaje).toHaveBeenLastCalledWith('t-1', 'v-1', { metodoPago: 'PUE', formaPago: '03', fechaLlegadaEstimada: null }, { id: 'u-1' });
  });
  it('éxito de sandbox se rotula de prueba; rechazo regresa motivo y faltantes', async () => {
    const a = (await accion(await pintar(), /^Timbrar/))!;
    expect((await a(null, fd({ metodoPago: 'PUE' }))).ok).toMatch(/DE PRUEBA.*U-1/);
    d.timbrarViaje.mockResolvedValueOnce({ ok: false, motivo: 'Falta dato', faltantes: ['RFC', 'CP'] });
    expect((await a(null, fd({ metodoPago: 'PUE' }))).error).toBe('Falta dato · RFC · CP');
  });
  it('un fallo del PAC nunca se da por «no emitido»', async () => {
    const a = (await accion(await pintar(), /^Timbrar/))!;
    d.timbrarViaje.mockRejectedValueOnce(new Error('red'));
    const r = await a(null, fd({ metodoPago: 'PUE' }));
    expect(r.error).toMatch(/No des el timbre por fallido/);
  });
});

describe('liberar el bloqueo y cancelar', () => {
  it('liberar exige el verbo y manda la declaración de haber verificado en el PAC', async () => {
    d.ctx = { ...base(), reservaPendiente: { uuidFiscal: null, reservadoEn: 'ayer' } };
    d.liberar.mockResolvedValue({ ok: true });
    const a = (await accion(await pintar(), /Liberar el bloqueo/))!;
    d.timbra = false;
    expect((await a(null, fd({ verificadoEnPac: 'on' }))).error).toMatch(/no puede liberar/);
    expect(d.liberar).not.toHaveBeenCalled();
    d.timbra = true;
    await a(null, fd({ verificadoEnPac: 'on' }));
    expect(d.liberar).toHaveBeenLastCalledWith('t-1', 'v-1', { id: 'u-1' }, true);
    await a(null, fd({}));
    expect(d.liberar).toHaveBeenLastCalledWith('t-1', 'v-1', { id: 'u-1' }, false);
  });
  it('cancelar exige verbo y segundo factor; confirmar manda lo verificado en el SAT', async () => {
    d.ctx = { ...base(), timbreVigente: { modo: 'produccion', uuidFiscal: 'U', fechaTimbrado: 'hoy', proveedor: 'sw', cancelacion: null } };
    d.cancelar.mockResolvedValue({ ok: true, mensaje: 'solicitada' });
    d.confirmar.mockResolvedValue({ ok: true, mensaje: 'cancelado' });
    const nodo = await pintar();
    const cancelar = prop(nodo, 'cancelar');
    expect(cancelar).toBeTypeOf('function');
    d.timbra = false;
    expect((await cancelar!(null, fd({ motivo: '02' }))).error).toMatch(/no puede cancelar/);
    d.timbra = true; d.paso = 'Falta el segundo factor.';
    expect((await cancelar!(null, fd({ motivo: '02' }))).error).toBe('Falta el segundo factor.');
    expect(d.cancelar).not.toHaveBeenCalled();
    d.paso = null;
    expect((await cancelar!(null, fd({ motivo: '01', folioSustitucion: 'UUID-2' }))).ok).toBe('solicitada');
    expect(d.cancelar).toHaveBeenLastCalledWith('t-1', 'v-1', { id: 'u-1' }, { motivo: '01', folioSustitucion: 'UUID-2' });
  });
});
