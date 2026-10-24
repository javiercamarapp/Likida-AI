import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S20-06 (lote z-resto-12): la señal PMF #3 se decide con el rol REAL, no el previsualizado.
const d = vi.hoisted(() => ({
  efectiva: { tenantId: 't-1', rol: 'flota_admin', userId: 'u-sup' } as Record<string, string>,
  real: { tenantId: 't-1', rol: 'superadmin', userId: 'u-sup' } as Record<string, string>,
  abrir: vi.fn(),
}));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ exigirVerRuta: async () => undefined, requireSessionTenant: async () => d.real }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => d.efectiva }));
vi.mock('@/lib/likida/comercial', () => ({
  getTickets: async () => [], abrirTicket: (...a: unknown[]) => d.abrir(...a),
  CATEGORIAS_TICKET: ['otro'], PRIORIDADES_TICKET: ['media'],
}));
vi.mock('@/lib/likida/soporte', () => ({
  getTicketDelTenant: vi.fn(), getHilo: vi.fn(), responderTicket: vi.fn(), cambiarEstadoTicket: vi.fn(), LARGO_MAX_MENSAJE: 2000,
}));

import SoportePage from './page';

type Acc = (previo: null, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accion(nodo: ReactNode, boton: RegExp): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map((n) => accion(n, boton)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (typeof nodo.props.accion === 'function' && boton.test(String(nodo.props.boton))) return nodo.props.accion as Acc;
  for (const v of Object.values(nodo.props)) {
    const r = accion(v as ReactNode, boton);
    if (r) return r;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  d.efectiva = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-sup' };
  d.real = { tenantId: 't-1', rol: 'superadmin', userId: 'u-sup' };
  d.abrir.mockResolvedValue(undefined);
});

describe('A37-S20-06: abrir ticket con ?rol= de previsualización', () => {
  it('un superadmin previsualizando como flota_admin abre con abierto_por NULL (no cuenta como queja del cliente)', async () => {
    const a = accion(await SoportePage({ searchParams: Promise.resolve({ rol: 'flota_admin' } as never) }), /ticket/i);
    expect(a).toBeDefined();
    await a!(null, new FormData());
    expect(d.abrir).toHaveBeenCalledWith('t-1', null, expect.anything());
  });

  it('un usuario real de la flota sigue abriendo con su id', async () => {
    d.real = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-dueno' };
    d.efectiva = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-dueno' };
    const a = accion(await SoportePage({ searchParams: Promise.resolve({}) }), /ticket/i);
    await a!(null, new FormData());
    expect(d.abrir).toHaveBeenCalledWith('t-1', 'u-dueno', expect.anything());
  });
});
