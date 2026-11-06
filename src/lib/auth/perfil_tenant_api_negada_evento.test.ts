import { beforeEach, describe, expect, it, vi } from 'vitest';

// CT-SEG-11: una API negada por el perfil de la flota deja fila de cobertura (api_negada), y una permitida no deja nada.
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('NEXT_REDIRECT'); } }));
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
const registrarApiNegada = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/seguridad/registro_acceso', () => ({ registrarApiNegada: (...a: unknown[]) => registrarApiNegada(...a) }));

const m = await import('./perfil_tenant');
const TENANT = '11111111-2222-4333-8444-555555555555';

beforeEach(() => { m.reiniciarCachePerfil(); registrarApiNegada.mockClear(); });

describe('apiDenegadaPorPerfil → evento api_negada', () => {
  it('negada: registra flota, ruta y causa perfil', async () => {
    expect(await m.apiDenegadaPorPerfil(TENANT, '/api/v1/clientes')).toBe(true);
    expect(registrarApiNegada).toHaveBeenCalledWith({ tenantId: TENANT, pathname: '/api/v1/clientes', causa: 'perfil' });
  });
  it('permitida: no registra', async () => {
    expect(await m.apiDenegadaPorPerfil(TENANT, '/api/v1/peajes/desgloses')).toBe(false);
    expect(registrarApiNegada).not.toHaveBeenCalled();
  });
});
