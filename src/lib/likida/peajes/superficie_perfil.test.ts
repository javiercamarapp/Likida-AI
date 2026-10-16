import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-A2-31: la superficie de peajes por perfil. Sin mocks de la lógica: solo la tabla `tenant_perfil` (como en perfil_tenant.test.ts).
type Resp = { data: unknown; error: { message: string; code?: string } | null };
let porTenant = new Map<string, Resp>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      let tenant: string | null = null;
      b.select = () => b;
      b.eq = (_c: string, v: string) => { tenant = v; return b; };
      b.maybeSingle = async () => porTenant.get(tenant ?? '') ?? { data: null, error: null };
      return b;
    },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('NEXT_REDIRECT'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
const m = await import('./superficie_perfil');

beforeEach(() => { reiniciarCachePerfil(); porTenant = new Map(); });

describe('superficiePeajesDePerfil (pura)', () => {
  it('sin perfil: todo como siempre', () => {
    expect(m.superficiePeajesDePerfil(null)).toEqual({ estimulo: true, cfdiYTickets: true, bitacoraEstimulo: true, gps: true, cursos: true });
  });
  it('cinco_agentes: todo el stand-by apagado', () => {
    expect(Object.values(m.superficiePeajesDePerfil('cinco_agentes')).every((v) => v === false)).toBe(true);
  });
  it('un perfil desconocido NO se trata como «sin perfil»: restringido', () => {
    expect(m.superficiePeajesDePerfil('otro')).toEqual(m.SUPERFICIE_PEAJES_RESTRINGIDA);
  });
});

describe('superficiePeajesDeTenant', () => {
  it('flota con fila de perfil: restringida', async () => {
    porTenant.set('t-con', { data: { perfil: 'cinco_agentes' }, error: null });
    expect(await m.superficiePeajesDeTenant('t-con')).toEqual(m.SUPERFICIE_PEAJES_RESTRINGIDA);
  });
  it('flota sin fila: completa (tenant completo sin cambios)', async () => {
    expect(await m.superficiePeajesDeTenant('t-sin')).toEqual(m.SUPERFICIE_PEAJES_COMPLETA);
  });
  it('FALLA CERRADO: si la tabla no se puede leer, restringida', async () => {
    porTenant.set('t-roto', { data: null, error: { message: 'boom' } });
    expect(await m.superficiePeajesDeTenant('t-roto')).toEqual(m.SUPERFICIE_PEAJES_RESTRINGIDA);
  });
  it('un valor de perfil que el código no conoce: restringida', async () => {
    porTenant.set('t-raro', { data: { perfil: 'futuro' }, error: null });
    expect(await m.superficiePeajesDeTenant('t-raro')).toEqual(m.SUPERFICIE_PEAJES_RESTRINGIDA);
  });
});
