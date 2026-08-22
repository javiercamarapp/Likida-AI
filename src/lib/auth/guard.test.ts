import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

// La selección explícita de flota (admin-context, 16-ago-2026): default SIN
// selección — que es exactamente el caso donde antes vivía el tenant
// implícito. Los casos con selección la ponen a mano.
const leerSeleccionFlota = vi.fn(async (): Promise<string | null> => null);
vi.mock('./admin-context', () => ({ leerSeleccionFlota: () => leerSeleccionFlota() }));

const { requireSessionTenant, requireSuperadmin } = await import('./guard');

describe('requireSessionTenant', () => {
  beforeEach(() => {
    redirect.mockClear();
    getSessionTenant.mockReset();
    leerSeleccionFlota.mockReset();
    leerSeleccionFlota.mockResolvedValue(null);
  });

  it('sin sesión, manda a /login con el next codificado', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard/abc-123')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/dashboard/abc-123')}`);
  });

  it('con sesión y rol pero sin tenant asignado, manda a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'flota_admin', nombre: null });
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  // El título de la prueba de arriba decía «sin alta en app_user (rol default
  // flota_admin)»: ese default se quitó el 4-ago-2026. Una sesión sin fila
  // legible ya no trae rol del dominio, trae `SIN_ROL` — y esa forma también
  // tiene que rebotar. Quién produce ese valor se prueba en `session.test.ts`,
  // que encadena el módulo real con estas puertas; aquí `getSessionTenant` está
  // mockeado y por eso no puede ver el default.
  it('con sesión pero SIN fila legible en app_user (SIN_ROL), también a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-9', tenantId: null, rol: 'sin_rol', nombre: null });
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // EL TENANT IMPLÍCITO MURIÓ (16-ago-2026, hallazgo #1 de la auditoría
  // externa). Aquí vivía «superadmin cae al tenant demo»: sin selector, un
  // superadmin en /dashboard miraba la demo SIN haberla elegido. Ahora la
  // flota es siempre explícita: la cookie firmada de /admin/elegir-flota, o
  // el "ver como" auditado (`?tenant=`/`?vista=demo`/`?rol=`) — y sin
  // ninguna, el selector.
  // ═════════════════════════════════════════════════════════════════════════
  const SUPER = { userId: 'u-2', tenantId: null, rol: 'superadmin', nombre: 'Javier' };

  it('superadmin SIN selección ni params: al selector de flota, jamás a la demo en silencio', async () => {
    getSessionTenant.mockResolvedValue(SUPER);
    leerSeleccionFlota.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard/viajes')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/admin/elegir-flota?next=${encodeURIComponent('/dashboard/viajes')}`);
  });

  it('superadmin CON flota elegida (cookie firmada): esa flota, sin rebote', async () => {
    getSessionTenant.mockResolvedValue(SUPER);
    leerSeleccionFlota.mockResolvedValue('t-elegida');
    const r = await requireSessionTenant('/dashboard');
    expect(redirect).not.toHaveBeenCalled();
    expect(r).toEqual({ ...SUPER, tenantId: 't-elegida' });
  });

  it('una cookie ILEGIBLE (firma rota/expirada → null) es NO-selección: al selector', async () => {
    // `leerSeleccionFlota` ya devuelve null para toda cookie que no valida
    // (admin-context.test.ts prueba el porqué); aquí se fija que el guard
    // trate ese null como "no eligió", nunca como demo.
    getSessionTenant.mockResolvedValue(SUPER);
    leerSeleccionFlota.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/admin/elegir-flota?next=${encodeURIComponent('/dashboard')}`);
  });

  it('el "ver como" auditado SIGUE: con `?tenant=`/`?vista=demo`/`?rol=`, la base demo de tenant-efectivo', async () => {
    vi.stubEnv('DEMO_TENANT_ID', 'demo-tenant-id');
    getSessionTenant.mockResolvedValue(SUPER);
    for (const sp of [{ tenant: 't-7' }, { vista: 'demo' }, { rol: 'contador' }]) {
      const r = await requireSessionTenant('/dashboard', sp);
      expect(r.tenantId).toBe('demo-tenant-id');
    }
    expect(redirect).not.toHaveBeenCalled();
    // Y la cookie NI SE LEE en ese camino: el preview no depende de ella.
    expect(leerSeleccionFlota).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('`?vista=` con otro valor que "demo" NO es intención de preview: al selector', async () => {
    getSessionTenant.mockResolvedValue(SUPER);
    leerSeleccionFlota.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard', { vista: 'rara' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/admin/elegir-flota?next=${encodeURIComponent('/dashboard')}`);
  });

  it('con sesión y tenant, regresa el SessionTenant tal cual', async () => {
    const s = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireSessionTenant('/dashboard')).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// `requireSuperadmin` es la puerta de /admin — la consola de negocio de
// Likida (docs/superpowers/plans/2026-08-02-panel-superadmin.md). Ningún
// otro rol la ve: ni siquiera flota_admin, que sí ve todo SU tenant, ve
// cuánto gasta Likida en IA o cuántos tenants tiene.
describe('requireSuperadmin', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireSuperadmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/admin')}`);
  });

  it('cualquier rol que no sea superadmin manda a /dashboard — es SU panel, no la consola de negocio', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null });
    await expect(requireSuperadmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('superadmin entra sin redirigir', async () => {
    const s = { userId: 'u-2', tenantId: null, rol: 'superadmin', nombre: 'Javier', operadorId: null };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireSuperadmin()).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · A19 — `requireVendedor` es la ÚNICA puerta de /vendedor y no
// tenía una sola prueba: con la condición de rol rota, un flota_admin de una
// flota cliente entraba a la versión ANCHA del panel (panel-vendedor calcula
// esVendedor = rol === 'vendedor' → false → listarProspectos({}) sin filtro:
// el pipeline comercial completo de Likida, competidores incluidos) y la suite
// seguía verde. `requireSuperadmin`, la puerta hermana, sí tenía tres.
// ═══════════════════════════════════════════════════════════════════════════
const { requireVendedor, exigirVerRuta } = await import('./guard');
const { inicioDe } = await import('./visibilidad');

describe('requireVendedor — la puerta de /vendedor', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login con next=/vendedor', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireVendedor()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/vendedor')}`);
  });

  it('vendedor entra y recibe SU sesión tal cual (la página filtra por su userId)', async () => {
    const s = { userId: 'u-v', tenantId: null, rol: 'vendedor', nombre: 'Vendedor' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireVendedor()).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('superadmin entra (soporte: es la consola de SU equipo de ventas)', async () => {
    const s = { userId: 'u-2', tenantId: null, rol: 'superadmin', nombre: 'Javier' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireVendedor()).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(['flota_admin', 'contador', 'encargado', 'operador'])(
    'un %s de una flota cliente NO entra: rebota a SU casa (inicioDe), jamás al pipeline comercial',
    async (rol) => {
      getSessionTenant.mockResolvedValue({ userId: 'u-c', tenantId: 't-cliente', rol, nombre: 'Cliente' });
      await expect(requireVendedor()).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledWith(inicioDe(rol));
      expect(inicioDe(rol)).not.toBe('/vendedor');
    },
  );

  it('una sesión sin rol legible (SIN_ROL) rebota a /sin-acceso — fail closed', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-9', tenantId: null, rol: 'sin_rol', nombre: null });
    await expect(requireVendedor()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });
});

describe('exigirVerRuta — el gate de pantalla por rol para los stubs', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('un encargado (solo operación) NO ve /dashboard/rentabilidad: rebota a su inicio', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-e', tenantId: 't-1', rol: 'encargado', nombre: 'Jefe' });
    await expect(exigirVerRuta('/dashboard/rentabilidad')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(inicioDe('encargado'));
  });

  it('un contador (dinero) sí la ve y recibe la sesión', async () => {
    const s = { userId: 'u-c', tenantId: 't-1', rol: 'contador', nombre: 'Conta' };
    getSessionTenant.mockResolvedValue(s);
    await expect(exigirVerRuta('/dashboard/rentabilidad')).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sin sesión pasa por requireSessionTenant: /login con el destino', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(exigirVerRuta('/dashboard/cobranza')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/dashboard/cobranza')}`);
  });
});
