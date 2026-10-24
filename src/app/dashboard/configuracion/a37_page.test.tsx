import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CONFIG } from '@/lib/likida/config';

// A37-S17-07 y A37-S17-08 (lote z-resto-12).
const d = vi.hoisted(() => ({
  sesion: { tenantId: 't-1', rol: 'flota_admin', userId: 'u-render' } as Record<string, string>,
  viaje: { data: null, error: null } as { data: unknown; error: unknown },
  lanza: false,
  guardarAjustes: vi.fn(),
  guardarRfcs: vi.fn(),
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => d.sesion }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/likida/config', async (orig) => ({
  ...await orig<typeof import('@/lib/likida/config')>(),
  getConfig: async () => DEMO_CONFIG,
}));
vi.mock('@/lib/likida/contabilidad/catalogo', async (orig) => ({
  ...await orig<typeof import('@/lib/likida/contabilidad/catalogo')>(),
  cuentasDeclaradas: async () => null,
}));
vi.mock('@/lib/likida/ajustes_operativos', async (orig) => ({
  ...await orig<typeof import('@/lib/likida/ajustes_operativos')>(),
  validarAjustes: () => ({}),
}));
vi.mock('@/lib/likida/administracion', async (orig) => ({
  ...await orig<typeof import('@/lib/likida/administracion')>(),
  guardarAjustesOperativos: (...a: unknown[]) => d.guardarAjustes(...a),
  guardarRfcsAdicionales: (...a: unknown[]) => d.guardarRfcs(...a),
}));
vi.mock('@/lib/supabase/admin', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'not', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => { if (d.lanza) throw new Error('timeout'); return d.viaje; };
  return { supabaseAdmin: () => q };
});

import ConfiguracionPage from './page';

type Acc = (previo: null, fd: FormData) => Promise<unknown>;
function accion(nodo: ReactNode, propiedad: string): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map((n) => accion(n, propiedad)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (typeof nodo.props[propiedad] === 'function') return nodo.props[propiedad] as Acc;
  return accion(nodo.props.children as ReactNode, propiedad);
}
const sp = { searchParams: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  d.sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-render' };
  d.viaje = { data: null, error: null };
  d.lanza = false;
  d.guardarAjustes.mockResolvedValue(undefined);
  d.guardarRfcs.mockResolvedValue(undefined);
});

describe('A37-S17-07: la bitácora firma con la sesión re-resuelta, no con la del render', () => {
  it('guardar ajustes y RFC adicionales atribuyen al usuario actual de la acción', async () => {
    const arbol = await ConfiguracionPage(sp);
    d.sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-nuevo-login' };
    await accion(arbol, 'guardar')!(null, new FormData());
    expect(d.guardarAjustes).toHaveBeenCalledWith('t-1', expect.anything(), { id: 'u-nuevo-login' });
    await accion(arbol, 'accion')!(null, new FormData());
    expect(d.guardarRfcs).toHaveBeenCalledWith('t-1', expect.anything(), { id: 'u-nuevo-login' });
  });
});

describe('A37-S17-08: una lectura caída del viaje de ejemplo no se pinta como «no hay viajes»', () => {
  it('con error de la consulta lo dice distinto', async () => {
    d.viaje = { data: null, error: { message: 'permission denied' } };
    const html = renderToStaticMarkup(await ConfiguracionPage(sp));
    expect(html).toContain('la lectura falló');
    expect(html).not.toContain('Todavía no hay un viaje con kilómetros');
  });

  it('con una excepción la página sigue renderizando y lo dice', async () => {
    d.lanza = true;
    const html = renderToStaticMarkup(await ConfiguracionPage(sp));
    expect(html).toContain('la lectura falló');
  });

  it('sin viajes (lectura buena) sigue diciendo que todavía no hay', async () => {
    const html = renderToStaticMarkup(await ConfiguracionPage(sp));
    expect(html).toContain('Todavía no hay un viaje con kilómetros');
    expect(html).not.toContain('la lectura falló');
  });
});
