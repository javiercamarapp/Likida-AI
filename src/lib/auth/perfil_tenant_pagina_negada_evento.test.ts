import { beforeEach, describe, expect, it, vi } from 'vitest';

// CT-SEG-11 (ronda 4): la pantalla negada por el perfil espera su registro (con tope) ANTES del redirect y sigue negando
// (fail-closed) aunque el registro falle o se cuelgue.
const orden: string[] = [];
vi.mock('next/navigation', () => ({ redirect: (d: string) => { orden.push(`redirect:${d}`); throw new Error('NEXT_REDIRECT'); } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: { perfil: 'cinco_agentes', ui_nivel: 'simple' }, error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  }),
}));
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
  registrarApiNegada: async () => {},
}));

const m = await import('./perfil_tenant');
const TENANT = '11111111-2222-4333-8444-555555555555';
const RUTA_NEGADA = '/dashboard/clientes';

beforeEach(() => { m.reiniciarCachePerfil(); orden.length = 0; registrarPaginaNegada.mockClear(); modo = 'ok'; vi.useRealTimers(); });

describe('exigirRutaDePerfil: pantalla negada', () => {
  it('registra y espera el registro antes de redirigir', async () => {
    await expect(m.exigirRutaDePerfil(TENANT, RUTA_NEGADA, 'flota_admin')).rejects.toThrow('NEXT_REDIRECT');
    expect(registrarPaginaNegada).toHaveBeenCalledWith({ ruta: RUTA_NEGADA, rol: 'flota_admin', causa: 'perfil', tenantId: TENANT });
    expect(orden.slice(0, 3)).toEqual(['registro:inicio', 'registro:fin', expect.stringMatching(/^redirect:/)]);
  });
  it('si el registro rechaza, igual niega (fail-closed)', async () => {
    modo = 'falla';
    await expect(m.exigirRutaDePerfil(TENANT, RUTA_NEGADA, 'flota_admin')).rejects.toThrow('NEXT_REDIRECT');
  });
  it('si el registro se cuelga, niega al vencer el tope', async () => {
    modo = 'colgado';
    vi.useFakeTimers();
    const r = m.exigirRutaDePerfil(TENANT, RUTA_NEGADA, 'flota_admin').catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(900);
    expect(await r).toBe('NEXT_REDIRECT');
  });
});
