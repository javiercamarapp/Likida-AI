import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// La puerta del panel elige el chrome según `versionUi`: v1 (sin cambios, SIN data-ui) o v2 (con data-ui="v2").
// Lo único falso es la sesión, la base y la lectura de la versión.

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({
  redirect: (a: string) => redirect(a),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: () => {} }),
}));
let galletas: Record<string, string> = {};
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n in galletas ? { value: galletas[n] } : undefined) }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signOut: async () => {} } }) }));
vi.mock('@/lib/auth/admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('@/app/api/dashboard/chat/tope', () => ({ topeDiaUsd: () => 0, gastoChatHoyUsd: async () => 0 }));
vi.mock('./pulso-producto', () => ({ PulsoProducto: () => null }));
vi.mock('./aviso-legal', () => ({ AvisoLegalPendiente: () => null }));

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));
const perfilDeTenant = vi.fn();
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: (...a: unknown[]) => perfilDeTenant(...a) }));
const versionUi = vi.fn();
vi.mock('@/lib/auth/version_ui', () => ({ versionUi: (...a: unknown[]) => versionUi(...a) }));

const { default: DashboardLayout } = await import('./layout');

const pintar = async () => renderToStaticMarkup(await DashboardLayout({ children: <p>pagina</p> }));

beforeEach(() => {
  vi.clearAllMocks();
  galletas = {};
  getSessionTenant.mockResolvedValue({ userId: 'u1', tenantId: 't1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null });
  perfilDeTenant.mockResolvedValue('cinco_agentes');
});

describe('DashboardLayout: v1 o v2', () => {
  it('versión v1: el chrome de siempre, sin data-ui', async () => {
    versionUi.mockResolvedValue('v1');
    const html = await pintar();
    expect(html).not.toContain('data-ui');
    expect(html).toContain('sb-aside');
    expect(html).toContain('<p>pagina</p>');
  });

  it('versión v2: el chrome nuevo con data-ui="v2" y el contenido', async () => {
    versionUi.mockResolvedValue('v2');
    const html = await pintar();
    expect(html).toContain('data-ui="v2"');
    expect(html).not.toContain('sb-aside');
    expect(html).toContain('<p>pagina</p>');
  });

  it('versionUi recibe el tenant, el rol de la sesión y las cookies; el perfil y la versión se piden juntos', async () => {
    versionUi.mockResolvedValue('v1');
    await pintar();
    expect(versionUi).toHaveBeenCalledTimes(1);
    expect(versionUi.mock.calls[0][0]).toBe('t1');
    expect(versionUi.mock.calls[0][1]).toBe('flota_admin');
    expect(typeof (versionUi.mock.calls[0][2] as { get: unknown }).get).toBe('function');
    expect(perfilDeTenant).toHaveBeenCalledWith('t1');
  });

  it('dos tenants no cruzan la versión: cada render pregunta por el suyo', async () => {
    versionUi.mockImplementation(async (t: string) => (t === 't-v2' ? 'v2' : 'v1'));
    getSessionTenant.mockResolvedValueOnce({ userId: 'u1', tenantId: 't-v2', rol: 'flota_admin', nombre: 'A', operadorId: null, avatarUrl: null });
    expect(await pintar()).toContain('data-ui="v2"');
    getSessionTenant.mockResolvedValueOnce({ userId: 'u2', tenantId: 't-v1', rol: 'flota_admin', nombre: 'B', operadorId: null, avatarUrl: null });
    expect(await pintar()).not.toContain('data-ui');
  });

  it('sin sesión rebota a /login (como siempre)', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(pintar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login?next=%2Fdashboard');
  });

  it('v2 con perfil: la insignia de Puesta en marcha sale de la cookie «listos/total» y solo de ella', async () => {
    versionUi.mockResolvedValue('v2');
    galletas = { likida_pem_t1: '2/6' };
    expect(await pintar()).toContain('2/6');
    galletas = { likida_pem_t1: '<script>x</script>' };
    expect(await pintar()).not.toContain('<script>x');
    galletas = { likida_pem_t1: '6/6' }; // completo: sin insignia
    expect(await pintar()).not.toContain('rv-insignia');
  });

  it('v1 no recibe insignia ni recorrido aunque exista la cookie', async () => {
    versionUi.mockResolvedValue('v1');
    galletas = { likida_pem_t1: '2/6' };
    expect(await pintar()).not.toContain('2/6');
  });
});
