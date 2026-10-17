import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL PERFIL `cinco_agentes` APLICADO DE VERDAD en las dos puertas por las que
// pasan TODAS las páginas y TODAS las server actions de /dashboard
// (`resolverTenantEfectivo` y `requireSessionTenant`). Sin mockear el perfil
// ni la visibilidad: lo único falso es la sesión y la tabla.
//
// Una server action de una pantalla en stand-by llama a la misma puerta con la
// ruta de su pantalla (RUTA), así que "URL directa" y "acción" son el mismo
// camino: se prueba con la ruta de cada módulo en stand-by.
// ═══════════════════════════════════════════════════════════════════════════

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (a: string) => redirect(a) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));
vi.mock('./admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('./mfa', async (orig) => ({ ...(await orig<Record<string, unknown>>()), mfaSuperadminObligatorio: () => false }));
vi.mock('./superadmin-mfa', () => ({ veredictoMfaDeSesion: async () => 'ok' }));

const perfiles = new Map<string, string>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      let id: string | null = null;
      b.select = () => b;
      b.eq = (_c: string, v: string) => { id = v; return b; };
      b.maybeSingle = async () => {
        if (tabla === 'tenant_perfil') return { data: perfiles.has(id ?? '') ? { perfil: perfiles.get(id!) } : null, error: null };
        if (tabla === 'tenant') return { data: { id, nombre: 'Flota' }, error: null };
        return { data: null, error: null };
      };
      b.upsert = () => b;
      b.insert = () => b;
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => {} }));

const { resolverTenantEfectivo } = await import('./tenant-efectivo');
const { requireSessionTenant } = await import('./guard');
const { reiniciarCachePerfil } = await import('./perfil_tenant');
const { RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, RUTAS_PERFIL_CINCO_AGENTES, rutaProximamenteEnPerfil } = await import('./visibilidad');

const CON = 'tenant-con-perfil';
const SIN = 'tenant-sin-perfil';
const dueno = (tenantId: string) => ({ userId: 'u1', tenantId, rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null });

beforeEach(() => {
  reiniciarCachePerfil();
  perfiles.clear();
  perfiles.set(CON, 'cinco_agentes');
  redirect.mockClear();
  getSessionTenant.mockReset();
});

describe('resolverTenantEfectivo (páginas y acciones)', () => {
  it('bajo el perfil, CADA ruta en stand-by rebota a /dashboard aunque el rol la vea', async () => {
    getSessionTenant.mockResolvedValue(dueno(CON));
    for (const ruta of RUTAS_STAND_BY_PERFIL_CINCO_AGENTES) {
      redirect.mockClear();
      // Las que el dueño ni siquiera veía por rol rebotan por la otra puerta (a su inicio, que es /dashboard).
      await expect(resolverTenantEfectivo(ruta, {}), ruta).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect, ruta).toHaveBeenCalledWith('/dashboard');
    }
  });

  it('bajo el perfil, cada ruta permitida que el rol ve SÍ abre (salvo las «próximamente», que van a su anuncio)', async () => {
    getSessionTenant.mockResolvedValue(dueno(CON));
    const rutas = Object.keys(RUTAS_PERFIL_CINCO_AGENTES).filter((r) => r !== '/dashboard/[id]' && !rutaProximamenteEnPerfil('cinco_agentes', r));
    for (const ruta of rutas) {
      redirect.mockClear();
      const r = await resolverTenantEfectivo(ruta, {});
      expect(r.tenantId, ruta).toBe(CON);
      expect(redirect, ruta).not.toHaveBeenCalled();
    }
  });

  it('SIN perfil nada cambia: las mismas rutas de stand-by abren para el dueño', async () => {
    getSessionTenant.mockResolvedValue(dueno(SIN));
    for (const ruta of ['/dashboard/chat', '/dashboard/facturacion', '/dashboard/suscripcion', '/dashboard/llaves-api']) {
      redirect.mockClear();
      const r = await resolverTenantEfectivo(ruta, {});
      expect(r.tenantId).toBe(SIN);
      expect(redirect).not.toHaveBeenCalled();
    }
  });

  it('una ruta nueva sin clasificar se niega bajo el perfil', async () => {
    getSessionTenant.mockResolvedValue(dueno(CON));
    await expect(resolverTenantEfectivo('/dashboard/modulo-nuevo', {})).rejects.toThrow('NEXT_REDIRECT');
  });

  it('el superadmin que mira la flota con perfil (?tenant=) ve lo mismo que el cliente', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'su', tenantId: null, rol: 'superadmin', nombre: 'Su', operadorId: null, avatarUrl: null });
    await expect(resolverTenantEfectivo('/dashboard/chat', { tenant: CON })).rejects.toThrow('NEXT_REDIRECT');
    redirect.mockClear();
    const r = await resolverTenantEfectivo('/dashboard/agentes/peajes', { tenant: CON });
    expect(r.tenantId).toBe(CON);
  });

  it('el superadmin que mira una flota SIN perfil no se ve afectado', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'su', tenantId: null, rol: 'superadmin', nombre: 'Su', operadorId: null, avatarUrl: null });
    const r = await resolverTenantEfectivo('/dashboard/chat', { tenant: SIN });
    expect(r.tenantId).toBe(SIN);
  });
});

describe('requireSessionTenant (acciones que usan esta puerta directo)', () => {
  it('bajo el perfil, una acción de una pantalla en stand-by rebota; una de un agente pasa', async () => {
    getSessionTenant.mockResolvedValue(dueno(CON));
    for (const ruta of ['/dashboard/agentes/facturas', '/dashboard/agentes/proveedores', '/dashboard/agentes/cobranza', '/dashboard/huerfanos']) {
      redirect.mockClear();
      await expect(requireSessionTenant(ruta), ruta).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledWith('/dashboard');
    }
    redirect.mockClear();
    await expect(requireSessionTenant('/dashboard/agentes/peajes')).resolves.toMatchObject({ tenantId: CON });
    await expect(requireSessionTenant('/dashboard/mi-perfil')).resolves.toMatchObject({ tenantId: CON });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('el detalle de liquidación (/dashboard/<uuid>) sigue abierto bajo el perfil', async () => {
    getSessionTenant.mockResolvedValue(dueno(CON));
    await expect(requireSessionTenant('/dashboard/0f8fad5b-d9cb-469f-a165-70867728950e')).resolves.toMatchObject({ tenantId: CON });
  });

  it('sin perfil, ninguna ruta cambia; rutas fuera de /dashboard no consultan el perfil', async () => {
    getSessionTenant.mockResolvedValue(dueno(SIN));
    await expect(requireSessionTenant('/dashboard/agentes/facturas')).resolves.toMatchObject({ tenantId: SIN });
    getSessionTenant.mockResolvedValue(dueno(CON));
    await expect(requireSessionTenant('/cuenta')).resolves.toMatchObject({ tenantId: CON });
  });
});

describe('una server action REAL de un módulo en stand-by (importada tal cual)', () => {
  it('bajo el perfil rebota antes de tocar un solo dato; sin perfil entra a su lógica', async () => {
    const acciones = await import('@/app/dashboard/agentes/facturas/acciones-control');
    getSessionTenant.mockResolvedValue(dueno(CON));
    await expect(acciones.accionEncenderEmision(null, new FormData())).rejects.toThrow('NEXT_REDIRECT');
    await expect(acciones.accionCambiarLimites(null, new FormData())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');

    // Sin perfil la acción SÍ pasa la puerta: llega a su lógica (que aquí falla por el repo falso,
    // pero NO por un redirect de perfil).
    redirect.mockClear();
    getSessionTenant.mockResolvedValue(dueno(SIN));
    await acciones.accionEncenderEmision(null, new FormData()).catch((e: Error) => expect(e.message).not.toBe('NEXT_REDIRECT'));
    expect(redirect).not.toHaveBeenCalled();
  });
});
