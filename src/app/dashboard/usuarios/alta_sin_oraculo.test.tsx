// A37-S21-02: el alta de usuarios contesta IGUAL y tarda IGUAL haya o no cuenta
// previa del correo (no enumera clientes de otras flotas).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const m = vi.hoisted(() => ({
  provisionar: vi.fn(async (..._a: unknown[]) => {}),
  correo: vi.fn(async (..._a: unknown[]): Promise<{ enviado: boolean; motivo?: string }> => ({ enviado: true })),
}));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('REDIRECT'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.sintetica.test' }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({
  resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: 'flota_admin', userId: 'u1', tenantNombre: 'Flota Sintética' }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }) }),
}));
vi.mock('@/lib/auth/provisionar', () => ({ provisionarUsuario: (...a: unknown[]) => m.provisionar(...a) }));
vi.mock('@/lib/auth/usuarios_escritura', () => ({
  cambiarRolUsuario: vi.fn(), desactivarUsuario: vi.fn(), reactivarUsuario: vi.fn(), reenviarAcceso: vi.fn(), cerrarSesionesUsuario: vi.fn(),
  enviarCorreoDeAcceso: (...a: unknown[]) => m.correo(...a),
}));
vi.mock('../../login/respuesta_otp', () => ({ conPisoDeTiempo: async <T,>(fn: () => Promise<T>) => fn() }));

const { default: UsuariosPage } = await import('./page');

type Accion = (previo: unknown, fd: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string }>;
function accionDe(nodo: ReactNode): Accion | null {
  if (Array.isArray(nodo)) { for (const n of nodo) { const a = accionDe(n); if (a) return a; } return null; }
  if (!nodo || typeof nodo !== 'object') return null;
  const el = nodo as ReactElement<Record<string, unknown>>;
  const p = el.props ?? {};
  const ac = p.acciones as { invitar?: Accion } | undefined;
  if (typeof ac?.invitar === 'function') return ac.invitar;
  return accionDe(p.children as ReactNode);
}
const fd = () => { const f = new FormData(); f.set('email', 'nuevo@sintetica.test'); f.set('nombre', 'Persona Sintética'); f.set('rol', 'contador'); f.set('telefono', ''); return f; };

beforeEach(() => { vi.clearAllMocks(); m.correo.mockResolvedValue({ enviado: true }); });

describe('A37-S21-02 el alta no es un oráculo', () => {
  it('correo nuevo (con correo enviado) y correo que ya tenía cuenta contestan el MISMO texto', async () => {
    const accion = accionDe(await UsuariosPage({ searchParams: Promise.resolve({}) }) as ReactNode);
    expect(accion, 'la página debe pasar la action `invitar`').toBeTruthy();
    const nuevo = await accion!(null, fd());
    m.provisionar.mockRejectedValueOnce(new Error('A user with this email address has already been registered'));
    const existente = await accion!(null, fd());
    expect(existente).toEqual(nuevo);
    expect(m.correo).toHaveBeenCalledTimes(1); // al ya registrado no se le manda correo
  });

  it('si el correo de la alta nueva NO salió, el texto sigue siendo el mismo', async () => {
    const accion = accionDe(await UsuariosPage({ searchParams: Promise.resolve({}) }) as ReactNode)!;
    const bueno = await accion(null, fd());
    m.correo.mockResolvedValue({ enviado: false, motivo: 'fallo' });
    expect(await accion(null, fd())).toEqual(bueno);
  });
});
