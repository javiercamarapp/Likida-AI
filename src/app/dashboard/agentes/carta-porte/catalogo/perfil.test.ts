import { describe, it, expect, vi, beforeEach } from 'vitest';

// La ruta del catálogo bajo el perfil `cinco_agentes` (T-A3-22): clasificada en la lista cerrada, así que abre para un
// tenant con perfil; lo que no está en la lista (una hermana nueva, una subruta) se niega. Sin mockear el perfil ni la
// visibilidad: lo único falso es la sesión y la tabla. Mismo montaje que `lib/auth/perfil_integracion.test.ts`.
const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (a: string) => redirect(a) }));
const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));
vi.mock('@/lib/auth/admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('@/lib/auth/mfa', async (orig) => ({ ...(await orig<Record<string, unknown>>()), mfaSuperadminObligatorio: () => false }));
vi.mock('@/lib/auth/superadmin-mfa', () => ({ veredictoMfaDeSesion: async () => 'ok' }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      let id: string | null = null;
      b.select = () => b;
      b.eq = (_c: string, v: string) => { id = v; return b; };
      b.maybeSingle = async () => (tabla === 'tenant_perfil' ? { data: { perfil: 'cinco_agentes' }, error: null } : tabla === 'tenant' ? { data: { id, nombre: 'Flota' }, error: null } : { data: null, error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => {} }));

const { resolverTenantEfectivo } = await import('@/lib/auth/tenant-efectivo');
const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
const { RUTAS_PERFIL_CINCO_AGENTES, rutaPermitidaEnPerfil, puedeVerRuta } = await import('@/lib/auth/visibilidad');

const RUTA = '/dashboard/agentes/carta-porte/catalogo';
const dueno = { userId: 'u1', tenantId: 'tenant-con-perfil', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null };

beforeEach(() => { reiniciarCachePerfil(); redirect.mockClear(); getSessionTenant.mockReset(); getSessionTenant.mockResolvedValue(dueno); });

describe('el catálogo del cliente bajo el perfil cinco_agentes', () => {
  it('está en la lista permitida, del módulo de Carta Porte, y abre para el dueño de un tenant con perfil', async () => {
    expect(RUTAS_PERFIL_CINCO_AGENTES[RUTA]).toBe('carta_porte');
    expect(rutaPermitidaEnPerfil('cinco_agentes', RUTA)).toBe(true);
    const r = await resolverTenantEfectivo(RUTA, {});
    expect(r.tenantId).toBe('tenant-con-perfil');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('lo que NO está en la lista se niega: una pantalla hermana nueva y una subruta sin clasificar rebotan a /dashboard', async () => {
    for (const ruta of [`${RUTA}-nuevo`, `${RUTA}/otra`, '/dashboard/agentes/carta-porte/catalogos']) {
      redirect.mockClear();
      expect(rutaPermitidaEnPerfil('cinco_agentes', ruta), ruta).toBe(false);
      await expect(resolverTenantEfectivo(ruta, {}), ruta).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect, ruta).toHaveBeenCalledWith('/dashboard');
    }
  });

  it('el rol decide primero: el contador (solo dinero) y el vendedor no ven el catálogo aunque la ruta esté en la lista', () => {
    expect(puedeVerRuta('flota_admin', RUTA)).toBe(true);
    expect(puedeVerRuta('contador', RUTA)).toBe(false);
    expect(puedeVerRuta('vendedor', RUTA)).toBe(false);
  });
});
