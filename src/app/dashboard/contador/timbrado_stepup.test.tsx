// R7-A3: el perfil fiscal del timbrado pide segundo factor reciente solo al cambiar el RFC o pasar a producción.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const m = vi.hoisted(() => ({
  aal: 'aal1' as string,
  vigente: { data: { rfc: 'AAA010101AAA', modo: 'sandbox' } as unknown, error: null as { message: string } | null },
  guardar: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('lucide-react', () => ({ Stamp: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/seguridad/eventos', () => ({ registrarEventoSeguridad: vi.fn(async () => {}) }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: 'contador', userId: 'u1' }) }));
vi.mock('@/lib/auth/tenant-atado', () => ({
  resolverTenantAtadoAccion: async () => ({ tenantId: 't1', rol: 'contador', userId: 'u1' }), MENSAJE_FLOTA_CAMBIO: 'cambio',
}));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => true }));
vi.mock('@/lib/likida/pac', () => ({ estadoPac: () => ({ configurado: false }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async (q: unknown) => q }));
vi.mock('@/lib/likida/administracion', () => ({ mensajeParaPantalla: (e: unknown) => String(e) }));
vi.mock('@/lib/likida/carta_porte_timbre', () => ({ guardarPerfilFiscal: (...a: unknown[]) => m.guardar(...a) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => m.vigente }) }) }) }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { mfa: {
    listFactors: async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] }, error: null }),
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: m.aal, currentAuthenticationMethods: [] }, error: null }),
  } } }),
}));
vi.mock('../../admin/ui/forma', () => ({ FormaConAviso: () => null, Campo: () => null, Selector: () => null }));

const { Timbrado } = await import('./timbrado');

type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accionDe(nodo: ReactNode): Accion | null {
  if (Array.isArray(nodo)) { for (const n of nodo) { const a = accionDe(n); if (a) return a; } return null; }
  if (!nodo || typeof nodo !== 'object') return null;
  const p = (nodo as ReactElement<Record<string, unknown>>).props ?? {};
  if (typeof p.accion === 'function') return p.accion as Accion;
  return accionDe(p.children as ReactNode);
}
const forma = (rfc: string, modo: string) => {
  const f = new FormData();
  f.set('rfc', rfc); f.set('razonSocial', 'Razon Sintetica'); f.set('regimenFiscal', '601'); f.set('lugarExpedicion', '42501'); f.set('serie', 'CCP'); f.set('modo', modo);
  return f;
};
const cargar = async () => accionDe(await Timbrado({ searchParams: {}, tenantExiste: true }) as ReactNode)!;

beforeEach(() => {
  vi.clearAllMocks();
  m.aal = 'aal1'; m.vigente = { data: { rfc: 'AAA010101AAA', modo: 'sandbox' }, error: null };
  vi.stubEnv('LIKIDA_TOTP_ESCALONADO', 'obligatorio');
});

describe('R7-A3 timbrado: perfil fiscal', () => {
  it('pasar a producción sin AAL2 vigente falla cerrado y no guarda', async () => {
    const r = await (await cargar())(null, forma('AAA010101AAA', 'produccion'));
    expect(r.error).toMatch(/segundo factor/);
    expect(m.guardar).not.toHaveBeenCalled();
  });
  it('cambiar el RFC sin AAL2 vigente falla cerrado', async () => {
    const r = await (await cargar())(null, forma('BBB020202BBB', 'sandbox'));
    expect(r.error).toMatch(/segundo factor/);
    expect(m.guardar).not.toHaveBeenCalled();
  });
  it('si no se pudo leer el perfil vigente, cierra', async () => {
    const accion = await cargar(); // la pantalla se pintó bien; la base cae justo antes de guardar
    m.vigente = { data: null, error: { message: 'caída' } };
    const r = await accion(null, forma('AAA010101AAA', 'sandbox'));
    expect(r.error).toMatch(/segundo factor/);
    expect(m.guardar).not.toHaveBeenCalled();
  });
  it('con AAL2 reciente sí guarda', async () => {
    m.aal = 'aal2';
    // un AAL2 sin marca de tiempo no se prueba reciente: se inyecta una verificación TOTP de hace un minuto
    const srv = await import('@/lib/supabase/server');
    vi.spyOn(srv, 'supabaseServer').mockResolvedValue({ auth: { mfa: {
      listFactors: async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] }, error: null }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', currentAuthenticationMethods: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] }, error: null }),
    } } } as never);
    const r = await (await cargar())(null, forma('AAA010101AAA', 'produccion'));
    expect(r.ok).toMatch(/guardado/);
    expect(m.guardar).toHaveBeenCalledTimes(1);
  });
  it('editar solo razón social o la serie en sandbox no pide el paso', async () => {
    const r = await (await cargar())(null, forma('AAA010101AAA', 'sandbox'));
    expect(r.ok).toMatch(/guardado/);
    expect(m.guardar).toHaveBeenCalledTimes(1);
  });
  it('con la palanca apagada nada cambia', async () => {
    vi.stubEnv('LIKIDA_TOTP_ESCALONADO', '');
    const r = await (await cargar())(null, forma('BBB020202BBB', 'produccion'));
    expect(r.ok).toMatch(/guardado/);
  });
});
