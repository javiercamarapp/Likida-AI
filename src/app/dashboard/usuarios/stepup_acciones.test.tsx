// R7-A1: el segundo factor reciente (`cambio_rol`) cubre TAMBIÉN invitar con rol de dueño/contador y reactivar una cuenta.
// Se usa el módulo real de step-up con la palanca encendida y una sesión en AAL1: tiene que fallar cerrado sin tocar nada.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const m = vi.hoisted(() => ({
  aal: 'aal1' as string,
  provisionar: vi.fn(async (..._a: unknown[]) => {}),
  correo: vi.fn(async (..._a: unknown[]) => ({ enviado: true })),
  reactivar: vi.fn(async (..._a: unknown[]) => ({ accesoRestaurado: true })),
  cambiarRol: vi.fn(async (..._a: unknown[]) => ({ de: 'encargado', a: 'contador' })),
}));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('REDIRECT'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.sintetica.test' }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/seguridad/eventos', () => ({ registrarEventoSeguridad: vi.fn(async () => {}) }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({
  resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: 'flota_admin', userId: 'u1', tenantNombre: 'Flota Sintética' }),
}));
vi.mock('@/lib/auth/tenant-atado', () => ({
  resolverTenantAtadoAccion: async () => ({ tenantId: 't1', rol: 'flota_admin', userId: 'u1', tenantNombre: 'Flota Sintética' }),
  MENSAJE_FLOTA_CAMBIO: 'cambio',
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { mfa: {
      listFactors: async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] }, error: null }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: m.aal, currentAuthenticationMethods: [] }, error: null }),
    } },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }) }),
}));
vi.mock('@/lib/auth/provisionar', () => ({ provisionarUsuario: (...a: unknown[]) => m.provisionar(...a) }));
vi.mock('@/lib/auth/usuarios_escritura', () => ({
  cambiarRolUsuario: (...a: unknown[]) => m.cambiarRol(...a),
  desactivarUsuario: vi.fn(), reactivarUsuario: (...a: unknown[]) => m.reactivar(...a), reenviarAcceso: vi.fn(), cerrarSesionesUsuario: vi.fn(),
  enviarCorreoDeAcceso: (...a: unknown[]) => m.correo(...a),
}));
vi.mock('../../login/respuesta_otp', () => ({ conPisoDeTiempo: async <T,>(fn: () => Promise<T>) => fn() }));

const { default: UsuariosPage } = await import('./page');

type Accion = (previo: unknown, fd: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string }>;
type Acciones = Record<string, Accion>;
function accionesDe(nodo: ReactNode): Acciones | null {
  if (Array.isArray(nodo)) { for (const n of nodo) { const a = accionesDe(n); if (a) return a; } return null; }
  if (!nodo || typeof nodo !== 'object') return null;
  const p = (nodo as ReactElement<Record<string, unknown>>).props ?? {};
  if (p.acciones && typeof (p.acciones as Acciones).invitar === 'function') return p.acciones as Acciones;
  return accionesDe(p.children as ReactNode);
}
const UUID = '11111111-1111-4111-8111-111111111111';
const forma = (rol: string) => { const f = new FormData(); f.set('email', 'nuevo@sintetica.test'); f.set('nombre', 'Persona'); f.set('rol', rol); f.set('telefono', ''); f.set('id', UUID); return f; };
const cargar = async () => accionesDe(await UsuariosPage({ searchParams: Promise.resolve({}) }) as ReactNode)!;

beforeEach(() => { vi.clearAllMocks(); m.aal = 'aal1'; vi.stubEnv('LIKIDA_TOTP_ESCALONADO', 'obligatorio'); });

describe('R7-A1 step-up en invitar y reactivar', () => {
  it.each(['flota_admin', 'contador'])('invitar con rol %s sin AAL2 vigente falla cerrado y no crea nada', async (rol) => {
    const a = await cargar();
    const r = await a.invitar(null, forma(rol));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/segundo factor/);
    expect(m.provisionar).not.toHaveBeenCalled();
    expect(m.correo).not.toHaveBeenCalled();
  });

  it('invitar un encargado no exige el paso (no es escalada)', async () => {
    const a = await cargar();
    const r = await a.invitar(null, forma('encargado'));
    expect(r.ok).toBe(true);
    expect(m.provisionar).toHaveBeenCalledTimes(1);
  });

  it('reactivar sin AAL2 vigente falla cerrado y no toca la cuenta', async () => {
    const a = await cargar();
    const r = await a.reactivar(null, forma('contador'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/segundo factor/);
    expect(m.reactivar).not.toHaveBeenCalled();
  });

  it('cambiar rol sigue protegido (regresión)', async () => {
    const a = await cargar();
    const r = await a.cambiarRol(null, forma('contador'));
    expect(r.ok).toBe(false);
    expect(m.cambiarRol).not.toHaveBeenCalled();
  });

  it('con palanca apagada nada cambia: invitar contador y reactivar pasan', async () => {
    vi.stubEnv('LIKIDA_TOTP_ESCALONADO', '');
    const a = await cargar();
    expect((await a.invitar(null, forma('contador'))).ok).toBe(true);
    expect((await a.reactivar(null, forma('contador'))).ok).toBe(true);
  });
});
