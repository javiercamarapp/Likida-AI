import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilaAccionesCotizacion } from './acciones';

// A37-S17-10 (lote z-resto-12): crear viaje desde una cotización es una escritura operativa.
const d = vi.hoisted(() => ({
  sesion: { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' } as Record<string, string>,
  convertir: vi.fn(),
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => d.sesion }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/cotizador/lector', () => ({
  getPanelCotizador: async () => ({
    config: null, clientes: [],
    cotizaciones: [{ id: 'q-1', estado: 'vigente', precio: 1000 }],
  }),
  guardarConfigCotizador: vi.fn(), crearCotizacion: vi.fn(), marcarEnviada: vi.fn(), marcarPerdida: vi.fn(),
  convertirEnViaje: (...a: unknown[]) => d.convertir(...a),
}));

import PaginaCotizaciones from './page';

type Conv = (previo: null, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function buscar(nodo: ReactNode): { convertir: Conv; puedeCrearViaje: boolean } | undefined {
  if (Array.isArray(nodo)) return nodo.map(buscar).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (typeof nodo.props.convertir === 'function') return nodo.props as never;
  return buscar(nodo.props.children as ReactNode);
}
const sp = { searchParams: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  d.sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
  d.convertir.mockResolvedValue(undefined);
});

describe('A37-S17-10: «Crear viaje» pide el permiso de despachar', () => {
  it('un contador (área dinero, sin puedeAsignar) es rechazado dentro de la action y no se crea nada', async () => {
    d.sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-c' };
    const fila = buscar(await PaginaCotizaciones(sp));
    expect(fila).toBeDefined();
    expect(fila!.puedeCrearViaje).toBe(false);
    const fd = new FormData(); fd.set('id', 'q-1');
    const r = await fila!.convertir(null, fd);
    expect(r.error).toMatch(/no puede crear viajes/);
    expect(d.convertir).not.toHaveBeenCalled();
  });

  it('el dueño sí crea el viaje', async () => {
    const fila = buscar(await PaginaCotizaciones(sp));
    expect(fila!.puedeCrearViaje).toBe(true);
    const fd = new FormData(); fd.set('id', 'q-1');
    expect((await fila!.convertir(null, fd)).ok).toMatch(/Viaje creado/);
    expect(d.convertir).toHaveBeenCalledWith('t-1', 'q-1', 'u-1');
  });

  it('el botón no se ofrece a quien no puede', () => {
    const ok = async () => ({ ok: 'listo' });
    const sin = renderToStaticMarkup(
      <FilaAccionesCotizacion id="q1" puedeEnviar={false} puedeCrearViaje={false} precio={1000} enviada={ok} convertir={ok} perdida={ok} />,
    );
    expect(sin).not.toContain('Crear viaje');
    expect(sin).toContain('Perdida');
  });
});
