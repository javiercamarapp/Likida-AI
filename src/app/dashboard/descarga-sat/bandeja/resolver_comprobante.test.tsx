// Fija, ANTES de migrar la bandeja del SAT, la acción que decide una deducción: las dos puertas (ruta y área dinero), las tres operaciones
// (ligar, archivar, deshacer), que ninguna operación inventada pase y que un fallo se diga.
import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  ve: true, area: true,
  ligar: vi.fn(), ignorar: vi.fn(), revertir: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: 'contador', userId: 'u1' }) }));
vi.mock('@/lib/auth/tenant-atado', () => ({ resolverTenantAtadoOLanza: async () => ({ tenantId: 't1', rol: 'contador', userId: 'u1' }) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => d.ve, puedeVerArea: () => d.area }));
vi.mock('@/lib/likida/administracion', () => ({ mensajeParaPantalla: (e: unknown) => `ERR ${String(e)}` }));
vi.mock('@/lib/likida/sat_descarga', () => ({ estadoDescargaSat: () => ({ configurado: true, proveedor: 'sw' }) }));
vi.mock('@/lib/likida/sat_descarga/resolucion', () => ({
  ligarComprobante: (...a: unknown[]) => d.ligar(...a),
  ignorarComprobante: (...a: unknown[]) => d.ignorar(...a),
  revertirResolucion: (...a: unknown[]) => d.revertir(...a),
}));

import { PanelBandeja } from './vista';

type Acc = (p: null, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accion(nodo: ReactNode): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map(accion).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (typeof nodo.props.accion === 'function') return nodo.props.accion as Acc;
  return accion(nodo.props.children as ReactNode);
}
const fila = { id: 'c-1', estatus: 'ambiguo', total: 100, fecha: '2026-11-01' };
const bandeja = { filas: [fila], estatus: 'ambiguo', pagina: 1, porPagina: 25, total: 1, paginaMax: 40, truncada: false, incompleta: false, historialTotal: 0, historialTruncado: false, error: null };
const datos = { config: null, solicitudes: [], conteos: null, incompleta: false };
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const cargar = async () => (await accion(await PanelBandeja({ searchParams: {}, tenantId: 't1', datos, bandeja, busqueda: null, prefill: { importe: '', desde: '', hasta: '', texto: '' } } as never) as ReactNode))!;

beforeEach(() => {
  vi.clearAllMocks(); d.ve = true; d.area = true;
  for (const f of [d.ligar, d.ignorar, d.revertir]) f.mockResolvedValue({ ok: true, mensaje: 'hecho' });
});

describe('bandeja del SAT: resolver un comprobante', () => {
  it('sin la ruta o sin el área de dinero no decide nada', async () => {
    const a = await cargar();
    d.ve = false;
    expect((await a(null, fd({ cfdi: 'c-1', operacion: 'ignorar', motivo: 'x' }))).error).toMatch(/no puede resolver/);
    d.ve = true; d.area = false;
    expect((await a(null, fd({ cfdi: 'c-1', operacion: 'ignorar', motivo: 'x' }))).error).toMatch(/no puede resolver/);
    expect(d.ignorar).not.toHaveBeenCalled();
  });
  it('exige el comprobante y rechaza una operación inventada', async () => {
    const a = await cargar();
    expect((await a(null, fd({ operacion: 'ignorar' }))).error).toMatch(/Falta decir sobre qué comprobante/);
    expect((await a(null, fd({ cfdi: 'c-1', operacion: 'borrar' }))).error).toMatch(/no existe/);
  });
  it('ligar, archivar y deshacer llaman a su función con el usuario y devuelven el mensaje', async () => {
    const a = await cargar();
    expect((await a(null, fd({ cfdi: 'c-1', operacion: 'ligar:g-9' }))).ok).toBe('hecho');
    expect(d.ligar).toHaveBeenCalledWith('t1', 'c-1', 'g-9', { id: 'u1' });
    await a(null, fd({ cfdi: 'c-1', operacion: 'ignorar', motivo: ' duplicado ' }));
    expect(d.ignorar).toHaveBeenCalledWith('t1', 'c-1', 'duplicado', { id: 'u1' });
    await a(null, fd({ cfdi: 'c-1', operacion: 'revertir', motivo: 'error' }));
    expect(d.revertir).toHaveBeenCalledWith('t1', 'c-1', 'error', { id: 'u1' });
  });
  it('un rechazo de la base se dice como error y un fallo no se disfraza de éxito', async () => {
    const a = await cargar();
    d.ligar.mockResolvedValueOnce({ ok: false, mensaje: 'ya ligado' });
    expect((await a(null, fd({ cfdi: 'c-1', operacion: 'ligar:g-9' }))).error).toBe('ya ligado');
    d.ignorar.mockRejectedValueOnce(new Error('caída'));
    expect((await a(null, fd({ cfdi: 'c-1', operacion: 'ignorar', motivo: 'x' }))).error).toMatch(/ERR/);
  });
});
