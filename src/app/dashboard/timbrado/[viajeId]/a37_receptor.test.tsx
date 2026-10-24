import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S20-07 (lote z-resto-12): el receptor fiscal se guarda sobre el cliente DEL VIAJE.
const d = vi.hoisted(() => ({
  leer: vi.fn(), guardar: vi.fn(),
  sesion: { tenantId: 't-1', rol: 'contador', userId: 'u-1' } as Record<string, string>,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => d.sesion }));
vi.mock('@/lib/likida/carta_porte_cfdi', () => ({ armarCfdiTimbrable: () => ({ ok: false, faltantes: ['x'] }) }));
vi.mock('@/lib/likida/carta_porte', () => ({ generarIdCcp: () => 'id' }));
vi.mock('@/lib/likida/carta_porte_cancelacion', () => ({ solicitarCancelacionTimbre: vi.fn(), confirmarCancelacionTimbre: vi.fn() }));
vi.mock('@/lib/likida/administracion', () => ({ mensajeParaPantalla: (e: Error) => `ERR ${e.message}` }));
vi.mock('@/lib/likida/carta_porte_timbre', () => ({
  leerContextoTimbre: (...a: unknown[]) => d.leer(...a),
  guardarReceptorFiscal: (...a: unknown[]) => d.guardar(...a),
  timbrarViaje: vi.fn(), liberarReservaTimbre: vi.fn(), motivoDeReservaViva: () => '', MINUTOS_MIN_LIBERAR_RESERVA: 30,
}));

import { SeccionTimbrado } from './timbrar';

type Acc = (previo: null, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accion(nodo: ReactNode): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map(accion).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (nodo.props.boton === 'Guardar datos del cliente') return nodo.props.accion as Acc;
  return accion(nodo.props.children as ReactNode);
}
const ctx = (clienteId: string | null) => ({
  emisor: {}, receptor: { razonSocial: null, regimenFiscal: null, usoCfdi: null, cpFiscal: null },
  clienteId, ingresoFlete: 1000, timbreVigente: null, reservaPendiente: null,
  pac: { configurado: true, proveedor: 'sw', pareceSandbox: true },
});
const V = { viajeId: 'v-1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  d.sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-1' };
  d.leer.mockResolvedValue(ctx('c-del-viaje'));
  d.guardar.mockResolvedValue(undefined);
});

describe('A37-S20-07: guardarReceptor ignora el clienteId del formulario', () => {
  it('guarda sobre el cliente del viaje aunque el POST mande el id de otro cliente de la flota', async () => {
    const a = accion(await SeccionTimbrado({ v: V, searchParams: {} }));
    const fd = new FormData();
    fd.set('clienteId', 'c-de-otro-cliente'); fd.set('razonSocial', 'ACME SA');
    const r = await a!(null, fd);
    expect(r.ok).toMatch(/guardados/);
    expect(d.guardar).toHaveBeenCalledWith('t-1', 'c-del-viaje', expect.objectContaining({ razonSocial: 'ACME SA' }), { id: 'u-1' });
    expect(d.guardar).not.toHaveBeenCalledWith(expect.anything(), 'c-de-otro-cliente', expect.anything(), expect.anything());
  });

  it('si el viaje ya no tiene cliente al ejecutar la acción, no escribe nada', async () => {
    const a = accion(await SeccionTimbrado({ v: V, searchParams: {} }));
    d.leer.mockResolvedValue(ctx(null));
    const fd = new FormData(); fd.set('clienteId', 'c-de-otro-cliente');
    const r = await a!(null, fd);
    expect(r.error).toMatch(/no tiene cliente/);
    expect(d.guardar).not.toHaveBeenCalled();
  });
});
