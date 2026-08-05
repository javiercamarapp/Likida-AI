import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, from: (...a: unknown[]) => from(...(a as [])) }),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const { getSessionTenant, SIN_ROL } = await import('./session');
const { areasDe, puedeVerRuta, inicioDe } = await import('./visibilidad');
const { puedeExportar, puedeAsignar, puedeAdministrar } = await import('./permisos');
// Las puertas REALES contra la sesión REAL. `guard.test.ts` mockea
// `getSessionTenant`, así que por construcción no puede ver qué rol nace de una
// fila ausente — que es exactamente lo que falló aquí.
const { requireSessionTenant, requireOperador, requireSuperadmin } = await import('./guard');
const { resolverTenantApi } = await import('./tenant-api');

describe('getSessionTenant', () => {
  beforeEach(() => { getUser.mockReset(); maybeSingle.mockReset(); eq.mockClear(); select.mockClear(); from.mockClear(); });

  it('sin usuario autenticado, regresa null', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getSessionTenant()).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('con usuario y fila en app_user, regresa tenantId/rol/nombre', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(from).toHaveBeenCalledWith('app_user');
    expect(select).toHaveBeenCalledWith('tenant_id, rol, nombre, operador_id, avatar_url');
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
    expect(r).toEqual({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null });
  });

  // ── EL DEFAULT PRIVILEGIADO (4-ago-2026) ──────────────────────────────────
  //
  // `rol: (data?.rol as string) ?? 'flota_admin'`. Sin fila legible —RLS, un
  // bache de red, o una cuenta de `auth.users` que nadie dio de alta— la sesión
  // nacía con el rol del DUEÑO de la flota. Y acaba de volverse más grave: la
  // base de producción se limpió y queda una sola cuenta, así que cualquier
  // correo que consiga una sesión de Supabase entraba como flota_admin.
  it('usuario autenticado SIN fila en app_user: no hereda un rol, se queda sin ninguno', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-2' } } });
    maybeSingle.mockResolvedValue({ data: null });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-2', tenantId: null, rol: SIN_ROL, nombre: null, operadorId: null, avatarUrl: null });
    expect(r!.rol, 'el default era el rol del dueño de la flota').not.toBe('flota_admin');
  });

  it('y ese no-rol NO abre nada: las cuatro matrices de permiso lo niegan', async () => {
    // Es lo que hace que un marcador de "sin fila" sea fallar CERRADO y no un
    // rol nuevo con privilegios accidentales. Si alguien agrega `sin_rol` a
    // `AREAS_POR_ROL` o a un `Set` de `permisos.ts`, esta prueba se pone roja.
    expect(areasDe(SIN_ROL)).toEqual([]);
    expect(puedeVerRuta(SIN_ROL, '/dashboard')).toBe(false);
    expect(puedeVerRuta(SIN_ROL, '/dashboard/cuadre')).toBe(false);
    expect(puedeExportar(SIN_ROL)).toBe(false);
    expect(puedeAsignar(SIN_ROL)).toBe(false);
    expect(puedeAdministrar(SIN_ROL)).toBe(false);
    // Y no tiene a dónde rebotar que no sea la pantalla que le explica qué le
    // falta: `inicioDe` de un rol sin áreas es /sin-acceso, no /dashboard.
    expect(inicioDe(SIN_ROL)).toBe('/sin-acceso');
  });

  it('tampoco lo hereda cuando la lectura de app_user FALLA: un error no es un rol', async () => {
    // supabase-js reporta por VALOR: sin mirar `error`, una base caída se lee
    // como "no hay fila" — y antes eso se traducía a flota_admin.
    getUser.mockResolvedValue({ data: { user: { id: 'u-7' } } });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied for table app_user' } });
    const r = await getSessionTenant();
    expect(r).toMatchObject({ userId: 'u-7', tenantId: null, rol: SIN_ROL });
    expect(logger.warn).toHaveBeenCalledWith('session.app_user_error', expect.objectContaining({ userId: 'u-7' }));
  });

  it('un error de lectura se REINTENTA antes de dejar la sesión sin rol', async () => {
    // Mismo criterio que el reintento de la excepción, y por la misma razón:
    // un bache de red al leer `app_user` mandaba a /sin-acceso a alguien que
    // acababa de iniciar sesión bien. Dos intentos, no un loop.
    getUser.mockResolvedValue({ data: { user: { id: 'u-8' } } });
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } })
      .mockResolvedValue({ data: { tenant_id: 't-1', rol: 'contador', nombre: 'Luz' } });
    const r = await getSessionTenant();
    expect(r).toMatchObject({ tenantId: 't-1', rol: 'contador' });
  });

  it('superadmin con fila app_user pero tenant_id null, preserva rol/nombre reales', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-3' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: null, rol: 'superadmin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-3', tenantId: null, rol: 'superadmin', nombre: 'Ana', operadorId: null, avatarUrl: null });
  });

  it('chofer: trae operadorId — la vista /mis-viajes lo necesita para saber qué es "lo suyo"', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-4' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'operador', nombre: 'Juan', operador_id: 'o-9' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-4', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: 'o-9', avatarUrl: null });
  });

  it('con avatar_url en app_user, lo trae en avatarUrl', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-6' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: null, rol: 'superadmin', nombre: 'Javier', avatar_url: 'https://x/avatares/u-6/foto.jpg' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-6', tenantId: null, rol: 'superadmin', nombre: 'Javier', operadorId: null, avatarUrl: 'https://x/avatares/u-6/foto.jpg' });
  });

  it('si Supabase truena las DOS veces, regresa null en vez de lanzar', async () => {
    getUser.mockRejectedValue(new Error('fetch failed'));
    expect(await getSessionTenant()).toBeNull();
  });

  it('si Supabase truena una vez pero se recupera al reintentar, regresa la sesión — no expulsa a alguien recién logueado por un bache', async () => {
    getUser.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue({ data: { user: { id: 'u-5' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'superadmin', nombre: 'Javier' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-5', tenantId: 't-1', rol: 'superadmin', nombre: 'Javier', operadorId: null, avatarUrl: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS PUERTAS, CON LA SESIÓN DE VERDAD.
//
// `guard.test.ts` mockea `getSessionTenant`, así que puede pasar la matriz
// entera con el default privilegiado puesto: nunca ve qué rol nace de una fila
// ausente. Estas pruebas encadenan el módulo real con las puertas reales, que
// es donde el `?? 'flota_admin'` se convertía en acceso.
// ═══════════════════════════════════════════════════════════════════════════
describe('una cuenta de auth.users sin fila en app_user no entra por ninguna puerta', () => {
  beforeEach(() => {
    getUser.mockReset(); maybeSingle.mockReset(); redirect.mockClear();
    getUser.mockResolvedValue({ data: { user: { id: 'u-fantasma' } } });
    maybeSingle.mockResolvedValue({ data: null });   // ← la fila no existe
  });

  it('/dashboard: a /sin-acceso, que es donde se le explica qué le falta', async () => {
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('/admin: NO es superadmin ni por accidente', async () => {
    await expect(requireSuperadmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).not.toHaveBeenCalledWith(expect.stringContaining('/admin'));
  });

  it('/chofer: rebota a /sin-acceso y ya no a /dashboard, que tampoco era suyo', async () => {
    // Con el default viejo el rebote era `inicioDe('flota_admin')` = /dashboard,
    // o sea que la puerta del chofer lo mandaba al panel del DUEÑO — que lo
    // volvía a rebotar. Ahora sale al sitio correcto en un salto.
    await expect(requireOperador('/chofer')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('las rutas de API (export, asistente): 403, y no la flota demo', async () => {
    const r = await resolverTenantApi('https://likida.ai/api/export/liquidaciones');
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('CONTROL — la misma cadena con fila SÍ abre, así que el candado no es un muro', async () => {
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    await expect(requireSessionTenant('/dashboard')).resolves.toMatchObject({ tenantId: 't-1', rol: 'flota_admin' });
    expect(redirect).not.toHaveBeenCalled();
  });
});
