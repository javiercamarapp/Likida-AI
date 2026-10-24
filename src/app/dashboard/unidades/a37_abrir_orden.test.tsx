import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S20-04 (lote z-resto-12): abrir orden de taller ya no traga los errores.
const d = vi.hoisted(() => ({
  abrir: vi.fn(),
  OrdenYaAbierta: class OrdenYaAbierta extends Error {},
  sesion: { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' } as Record<string, string>,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => d.sesion }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (e: Error, op: string) => `FALLA ${op}: ${e.message}` }));
vi.mock('@/lib/likida/mantenimiento', () => ({
  getTaller: async () => ({
    ordenesAbiertas: [], rutinas: [{ id: 'r-1' }],
    propuestas: [{ rutinaId: 'r-1', unidadId: 'u-9', unidadEco: 'T-9', rutinaNombre: 'Motor', motivo: 'vencida_por_dias', diasDesdeServicio: 200, kmDesdeServicio: null }],
  }),
  validarRutina: vi.fn(), crearRutina: vi.fn(), cerrarOrden: vi.fn(),
  abrirOrdenProgramada: (...a: unknown[]) => d.abrir(...a),
  OrdenYaAbierta: d.OrdenYaAbierta,
}));

import { BloqueTaller } from './taller';

type Acc = (previo: null, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accionAbrir(nodo: ReactNode): Acc | undefined {
  if (Array.isArray(nodo)) return nodo.map(accionAbrir).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(nodo)) return;
  if (nodo.props.boton === 'Abrir orden') return nodo.props.accion as Acc;
  return accionAbrir(nodo.props.children as ReactNode);
}
function fd() { const f = new FormData(); f.set('rutinaId', 'r-1'); f.set('unidadId', 'u-9'); return f; }
const sp = {};

beforeEach(() => {
  vi.clearAllMocks();
  d.sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
  d.abrir.mockResolvedValue(undefined);
});

describe('A37-S20-04: abrir orden de taller', () => {
  it('un error real (rutina inexistente, unidad ajena, base caída) llega a la pantalla', async () => {
    d.abrir.mockRejectedValue(new Error('Esa unidad no existe en tu flota.'));
    const a = accionAbrir(await BloqueTaller({ sp }));
    const r = await a!(null, fd());
    expect(r.error).toContain('Esa unidad no existe en tu flota.');
    expect(r.ok).toBeUndefined();
  });

  it('el choque de la unique (doble clic perdedor) es benigno: sin error', async () => {
    d.abrir.mockRejectedValue(new d.OrdenYaAbierta('ya'));
    const a = accionAbrir(await BloqueTaller({ sp }));
    const r = await a!(null, fd());
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/ya estaba abierta/);
  });

  it('éxito dice que se abrió; un rol sin permiso recibe el rechazo (no un silencio)', async () => {
    const a = accionAbrir(await BloqueTaller({ sp }));
    expect((await a!(null, fd())).ok).toBe('Orden abierta.');
    d.sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-c' };
    const r = await a!(null, fd());
    expect(r.error).toMatch(/encargado o del dueño/);
    expect(d.abrir).toHaveBeenCalledTimes(1);
  });
});
