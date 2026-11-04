// CT-SEG-23: la pantalla de baja informa si las llaves de API quedaron vivas.
import { expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const m = vi.hoisted(() => ({
  baja: vi.fn(),
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
  cambiarRolUsuario: vi.fn(), desactivarUsuario: (...a: unknown[]) => m.baja(...a), reactivarUsuario: vi.fn(), reenviarAcceso: vi.fn(), cerrarSesionesUsuario: vi.fn(),
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
  const ac = p.acciones as { darDeBaja?: Accion } | undefined;
  if (typeof ac?.darDeBaja === 'function') return ac.darDeBaja;
  return accionDe(p.children as ReactNode);
}

const U = '11111111-2222-4333-8444-555555555555';
it('si la revocacion de llaves falla, la pantalla NO dice solo que todo salio bien', async () => {
  m.baja.mockResolvedValue({ sesionRevocada: true, llavesApiRevocadas: [], llavesApiSinRevocar: true });
  const accion = accionDe(await UsuariosPage({ searchParams: Promise.resolve({}) }) as ReactNode)!;
  expect(accion).toBeTruthy();
  const f = new FormData(); f.set('id', U);
  const r = await accion(null, f);
  expect(r.mensaje).toMatch(/llaves de API/);
  expect(r.mensaje).toMatch(/NO se pudieron revocar/);
});
it('nombra las llaves revocadas', async () => {
  m.baja.mockResolvedValue({ sesionRevocada: true, llavesApiRevocadas: ['TMS propio'], llavesApiSinRevocar: false });
  const accion = accionDe(await UsuariosPage({ searchParams: Promise.resolve({}) }) as ReactNode)!;
  const f = new FormData(); f.set('id', U);
  expect((await accion(null, f)).mensaje).toMatch(/TMS propio/);
});
