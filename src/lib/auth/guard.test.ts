import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

const { requireSessionTenant, requireOperador, requireSuperadmin } = await import('./guard');

describe('requireSessionTenant', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login con el next codificado', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard/abc-123')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/dashboard/abc-123')}`);
  });

  it('con sesión pero sin tenant y sin alta en app_user (rol default flota_admin), manda a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'flota_admin', nombre: null });
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('superadmin (tenant_id null por diseño) NO va a /sin-acceso — cae al tenant demo', async () => {
    vi.stubEnv('DEMO_TENANT_ID', 'demo-tenant-id');
    getSessionTenant.mockResolvedValue({ userId: 'u-2', tenantId: null, rol: 'superadmin', nombre: 'Javier' });
    const r = await requireSessionTenant('/dashboard');
    expect(redirect).not.toHaveBeenCalled();
    expect(r).toEqual({ userId: 'u-2', tenantId: 'demo-tenant-id', rol: 'superadmin', nombre: 'Javier' });
    vi.unstubAllEnvs();
  });

  it('con sesión y tenant, regresa el SessionTenant tal cual', async () => {
    const s = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireSessionTenant('/dashboard')).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// `requireOperador` es la puerta de /mis-viajes (Task 5 del plan de roles):
// el reverso de `requireSessionTenant`, que asume el panel de flota_admin/
// encargado/contador. Un chofer que aterrice ahí por error no debe ver ESE
// panel (RLS ya se lo impediría, pero la UI ni se lo ofrece).
describe('requireOperador', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión y sin destino, manda a /login con el default de siempre', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireOperador()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/mis-viajes')}`);
  });

  // ── LA LIGA PROFUNDA DE WHATSAPP PERDÍA SU RUTA DE VUELTA ──────────────
  //
  // El rebote era `/login?next=%2Fmis-viajes` ESCRITO A MANO. El chofer llega
  // por un enlace que apunta a una pantalla concreta ("mira tu saldo",
  // /chofer/liquidacion), así que después de iniciar sesión aterrizaba en la
  // pantalla vieja de solo lectura en vez de en la que le mandaron.
  it.each([
    '/chofer',
    '/chofer/liquidacion',
    '/chofer/comprobantes',
    '/chofer/viajes',
  ])('sin sesión, conserva el destino %s', async (destino) => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireOperador(destino)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(destino)}`);
  });

  it('el destino se CODIFICA: una ruta con query no rompe el `next`', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireOperador('/chofer/viajes?ver=todos')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login?next=%2Fchofer%2Fviajes%3Fver%3Dtodos');
  });

  it('rol distinto de operador (flota_admin, encargado, superadmin) manda a /dashboard — es SU panel, no el de un chofer', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null });
    await expect(requireOperador()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('al CONTADOR no se le manda a /dashboard, que es de operación y lo rebotaría otra vez', async () => {
    // El rebote era '/dashboard' fijo. Para el contador esa ruta es área
    // `dinero`→no: `resolverTenantEfectivo` lo rebota de vuelta y quedaba un
    // ping-pong de redirects. `inicioDe` ya sabía la respuesta correcta.
    getSessionTenant.mockResolvedValue({ userId: 'u-4', tenantId: 't-1', rol: 'contador', nombre: 'Luz', operadorId: null });
    await expect(requireOperador('/chofer')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard/contador');
  });

  it('operador sin operador_id ligado (alta a medias) manda a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-2', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: null });
    await expect(requireOperador()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('operador con todo en regla, regresa la sesión con operadorId no nulo', async () => {
    const s = { userId: 'u-3', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: 'o-9' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireOperador()).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });

  // ── EL ALTA A MEDIAS QUE SÍ PASA LA PUERTA ──────────────────────────────
  //
  // Esta puerta exige `operador_id`, no `tenant_id`, y eso es correcto: hay
  // panel que enseñar. Pero significa que un chofer con `tenant_id` nulo
  // ENTRA, y quien lo atiende del otro lado es la página. Se fija aquí para
  // que el día que alguien "arregle" esto agregando un `if (!s.tenantId)
  // redirect('/sin-acceso')` sepa que está cambiando el contrato con /chofer.
  it('un operador SIN tenant pasa la puerta — el aviso de alta incompleta es de la página', async () => {
    const s = { userId: 'u-5', tenantId: null, rol: 'operador', nombre: 'Juan', operadorId: 'o-9' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireOperador('/chofer')).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('un operador sin tenant NO se manda a /login: ya inició sesión', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-5', tenantId: null, rol: 'operador', nombre: 'Juan', operadorId: 'o-9' });
    await requireOperador('/chofer');
    expect(redirect).not.toHaveBeenCalledWith(expect.stringContaining('/login'));
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
