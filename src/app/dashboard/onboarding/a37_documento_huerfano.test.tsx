import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S19-08 (lote z-resto-12): el documento subido no queda huérfano si el perfil no se guardó.
const d = vi.hoisted(() => ({
  Parcial: class Parcial extends Error {},
  subir: vi.fn(), borrar: vi.fn(), guardar: vi.fn(),
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/likida/repo', () => ({ getPerfilCrudo: async () => ({}), guardarPerfilPatch: vi.fn() }));
vi.mock('@/lib/likida/perfil/onboarding', () => ({ parseOnboarding: () => ({ ok: true, datos: {} }) }));
vi.mock('@/lib/likida/perfil/documentos', () => ({
  subirPoliticaPerfil: (...a: unknown[]) => d.subir(...a),
  borrarPoliticaPerfil: (...a: unknown[]) => d.borrar(...a),
}));
vi.mock('@/lib/likida/perfil/guardar_forma', () => ({
  guardarPerfilFormulario: (...a: unknown[]) => d.guardar(...a),
  PerfilGuardadoParcial: d.Parcial,
}));
vi.mock('@/lib/likida/administracion', () => ({ mensajeParaPantalla: (e: Error) => `ERR ${e.message}` }));
vi.mock('./chat', () => ({ ChatEntrevista: () => null }));
vi.mock('./forma', () => ({ FormaOnboarding: () => null }));

import OnboardingFlotaPage from './page';

type Acc = (previo: null, fd: FormData) => Promise<{ error?: string }>;
function accion(nodo: ReactNode): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map(accion).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (typeof nodo.props.accion === 'function') return nodo.props.accion as Acc;
  for (const v of Object.values(nodo.props)) {
    const r = accion(v as ReactNode);
    if (r) return r;
  }
}
const RUTA_DOC = 'perfil/t-1/politica-abc.pdf';
function conArchivo(): FormData {
  const fd = new FormData();
  fd.set('politica', new File([new Uint8Array([1, 2])], 'p.pdf', { type: 'application/pdf' }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  d.subir.mockResolvedValue({ path: RUTA_DOC, nombre: 'p.pdf', contentType: 'application/pdf' });
  d.borrar.mockResolvedValue(undefined);
  d.guardar.mockResolvedValue(undefined);
});

describe('A37-S19-08: documento de política huérfano', () => {
  it('si el perfil no se pudo guardar, borra el documento recién subido', async () => {
    d.guardar.mockRejectedValue(new Error('base caída'));
    const a = accion(await OnboardingFlotaPage({ searchParams: Promise.resolve({}) }));
    const r = await a!(null, conArchivo());
    expect(r.error).toContain('base caída');
    expect(d.borrar).toHaveBeenCalledWith('t-1', RUTA_DOC);
  });

  it('si el perfil SÍ quedó escrito y falló la parte derivada, conserva el documento (ya está referenciado)', async () => {
    d.guardar.mockRejectedValue(new d.Parcial('parcial'));
    const a = accion(await OnboardingFlotaPage({ searchParams: Promise.resolve({}) }));
    await a!(null, conArchivo());
    expect(d.borrar).not.toHaveBeenCalled();
  });

  it('sin archivo no hay nada que borrar', async () => {
    d.guardar.mockRejectedValue(new Error('x'));
    const a = accion(await OnboardingFlotaPage({ searchParams: Promise.resolve({}) }));
    await a!(null, new FormData());
    expect(d.borrar).not.toHaveBeenCalled();
  });
});
