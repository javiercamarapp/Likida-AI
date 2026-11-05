import { beforeEach, describe, expect, it, vi } from 'vitest';

// CT-SEG-11 (ronda 4): la pantalla negada por rol en resolverTenantEfectivo espera su registro (con tope) ANTES del redirect
// y sigue negando (fail-closed) aunque el registro falle o se cuelgue.
const orden: string[] = [];
vi.mock('next/navigation', () => ({
  redirect: (d: string) => { orden.push(`redirect:${d}`); throw new Error('NEXT_REDIRECT'); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
const requireSessionTenant = vi.fn();
vi.mock('./guard', () => ({ requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let modo: 'ok' | 'falla' | 'colgado' = 'ok';
const registrarPaginaNegada = vi.fn((..._a: unknown[]): Promise<void> => {
  orden.push('registro:inicio');
  if (modo === 'falla') return Promise.reject(new Error('boom'));
  if (modo === 'colgado') return new Promise<void>(() => {});
  return Promise.resolve().then(() => { orden.push('registro:fin'); });
});
vi.mock('@/lib/seguridad/registro_acceso', () => ({
  registrarPaginaNegada: (...a: unknown[]) => registrarPaginaNegada(...a),
}));

const { resolverTenantEfectivo } = await import('./tenant-efectivo');
const RUTA_NEGADA = '/dashboard/clientes';
const SESION = { tenantId: '11111111-2222-4333-8444-555555555555', userId: 'u1', rol: 'operador' };

beforeEach(() => {
  orden.length = 0; registrarPaginaNegada.mockClear(); modo = 'ok'; vi.useRealTimers();
  requireSessionTenant.mockResolvedValue({ ...SESION });
});

describe('resolverTenantEfectivo: pantalla negada por rol', () => {
  it('registra y espera el registro antes de redirigir', async () => {
    await expect(resolverTenantEfectivo(RUTA_NEGADA, undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(registrarPaginaNegada).toHaveBeenCalledWith({ ruta: RUTA_NEGADA, rol: 'operador', causa: 'rol', tenantId: SESION.tenantId, userId: 'u1' });
    expect(orden.slice(0, 3)).toEqual(['registro:inicio', 'registro:fin', expect.stringMatching(/^redirect:/)]);
  });
  it('si el registro rechaza, igual niega (fail-closed)', async () => {
    modo = 'falla';
    await expect(resolverTenantEfectivo(RUTA_NEGADA, undefined)).rejects.toThrow('NEXT_REDIRECT');
  });
  it('si el registro se cuelga, niega al vencer el tope', async () => {
    modo = 'colgado';
    vi.useFakeTimers();
    const r = resolverTenantEfectivo(RUTA_NEGADA, undefined).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(900);
    expect(await r).toBe('NEXT_REDIRECT');
  });
});
