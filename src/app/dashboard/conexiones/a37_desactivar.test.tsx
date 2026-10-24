import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S17-06 y A37-S17-09 (lote z-resto-12).
const d = vi.hoisted(() => ({
  desactivar: vi.fn(),
  perfil: 'cinco_agentes' as string | null,
  sesion: { tenantId: 't-1', rol: 'flota_admin', userId: 'u-dueno' },
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => d.sesion }));
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => d.perfil }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/likida/conexiones', () => ({ getConexiones: async () => [], contarCredencialesGps: async () => 0 }));
vi.mock('@/lib/likida/conectores/cofre', () => ({ cofreConfigurado: () => true }));
vi.mock('@/lib/likida/conectores/credenciales', () => ({
  guardarCredencial: vi.fn(), probarCredencial: vi.fn(),
  listarCredenciales: async () => [],
  desactivarCredencial: (...a: unknown[]) => d.desactivar(...a),
}));
vi.mock('@/lib/likida/gps_push/panel', () => ({ armarPanelGps: async () => ({ error: 'x' }) }));
vi.mock('@/lib/likida/gps_push/datos', () => ({ generarSecretoPush: vi.fn() }));
vi.mock('@/lib/likida/importacion/panel', () => ({ mapearGpsDesdeArchivo: vi.fn() }));
vi.mock('@/lib/likida/conectores/tabla_propia/importar_geocercas', () => ({ importarGeocercasDeTablaPropia: vi.fn() }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn() }));

import PaginaConexiones from './page';
import { descripcionDesactivar } from './credenciales-controles';

type Desactivar = (previo: null, fd: FormData) => Promise<{ ok: boolean; error?: string }>;
function acciones(nodo: ReactNode): { desactivar?: Desactivar } | undefined {
  if (Array.isArray(nodo)) return nodo.map(acciones).find(Boolean);
  if (!isValidElement<Record<string, ReactNode>>(nodo)) return;
  const a = nodo.props.acciones as unknown as { desactivar?: Desactivar } | undefined;
  if (a?.desactivar) return a;
  for (const v of Object.values(nodo.props)) {
    const r = acciones(v);
    if (r) return r;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  d.perfil = 'cinco_agentes';
  d.sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-dueno' };
  d.desactivar.mockResolvedValue(undefined);
});

describe('A37-S17-06: el texto de «Desactivar» dice la verdad', () => {
  it('avisa que el secreto se destruye y no promete que queda cifrado para auditoría', () => {
    const t = descripcionDesactivar('Sistema X');
    expect(t).toContain('se destruye');
    expect(t).toContain('últimos 4');
    expect(t).not.toMatch(/no se borra|queda cifrado/i);
  });
});

describe('A37-S17-09: desactivar no depende del perfil', () => {
  it('un conector fuera del perfil cinco_agentes SÍ se puede desactivar (destruir el secreto propio)', async () => {
    const a = acciones(await PaginaConexiones({ searchParams: Promise.resolve({}) }));
    const fd = new FormData();
    fd.set('conector', 'erp_fuera_de_perfil');
    const r = await a!.desactivar!(null, fd);
    expect(r.ok).toBe(true);
    expect(d.desactivar).toHaveBeenCalledWith('t-1', 'erp_fuera_de_perfil', { id: 'u-dueno' });
  });

  it('sigue exigiendo ser dueño: la action re-resuelve el rol adentro', async () => {
    const a = acciones(await PaginaConexiones({ searchParams: Promise.resolve({}) }));
    d.sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-x' };
    const r = await a!.desactivar!(null, new FormData());
    expect(r.ok).toBe(false);
    expect(d.desactivar).not.toHaveBeenCalled();
  });
});
