import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(), anotar: vi.fn(), crear: vi.fn(), actualizar: vi.fn(), terminar: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ anotarAccionAdmin: dobles.anotar, AVISO_SIN_BITACORA: ' [SIN BITACORA]' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/backoffice/contratos', () => ({ crearContrato: dobles.crear, actualizarContrato: dobles.actualizar, terminarContrato: dobles.terminar }));

import { accionGuardarContrato, accionTerminarContrato } from './acciones';

const forma = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', email: 'j@x.mx' });
  dobles.anotar.mockReset().mockResolvedValue(true);
  dobles.crear.mockReset().mockResolvedValue({ ok: true, id: 'c1' });
  dobles.actualizar.mockReset().mockResolvedValue({ ok: true, id: 'c1' });
  dobles.terminar.mockReset().mockResolvedValue({ ok: true, id: 'c1' });
});

describe('accionGuardarContrato', () => {
  it('sin id crea, anota bo_contrato.creado y devuelve ok', async () => {
    const r = await accionGuardarContrato(null, forma({ tipo: 'suscripcion', contraparte: 'Vercel', venceEl: '2026-12-01' }));
    expect(r?.ok).toContain('Vercel');
    expect(dobles.crear).toHaveBeenCalledOnce();
    expect(dobles.actualizar).not.toHaveBeenCalled();
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_contrato.creado', entidad: 'bo_contrato', entidadId: 'c1', tenantId: null }));
  });
  it('con id actualiza y anota bo_contrato.actualizado', async () => {
    await accionGuardarContrato(null, forma({ id: 'c1', tipo: 'dominio', contraparte: 'likida.ai' }));
    expect(dobles.actualizar).toHaveBeenCalledWith('c1', expect.objectContaining({ tipo: 'dominio' }));
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_contrato.actualizado' }));
  });
  it('un rechazo de la librería se dice en pantalla y NO se anota nada', async () => {
    dobles.crear.mockResolvedValue({ ok: false, error: 'sin_rfc' });
    const r = await accionGuardarContrato(null, forma({ tipo: 'cliente', contraparte: 'X' }));
    expect(r?.error).toContain('Likida aún no tiene razón social ni RFC propios');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });
  it('si la bitácora falla lo dice (el acto ya ocurrió)', async () => {
    dobles.anotar.mockResolvedValue(false);
    const r = await accionGuardarContrato(null, forma({ tipo: 'otro', contraparte: 'Z' }));
    expect(r?.ok).toContain('[SIN BITACORA]');
  });
  it('la puerta de superadmin va primero: si rechaza, no se escribe', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(accionGuardarContrato(null, forma({ tipo: 'otro', contraparte: 'Z' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.crear).not.toHaveBeenCalled();
  });
  it('una excepción inesperada devuelve error, no revienta', async () => {
    dobles.crear.mockRejectedValue(new Error('boom'));
    const r = await accionGuardarContrato(null, forma({ tipo: 'otro', contraparte: 'Z' }));
    expect(r?.error).toBeTruthy();
  });
});

describe('accionTerminarContrato', () => {
  it('termina con motivo y anota el motivo en la bitácora', async () => {
    const r = await accionTerminarContrato(null, forma({ id: 'c1', motivo: 'ya no se usa' }));
    expect(r?.ok).toBeTruthy();
    expect(dobles.terminar).toHaveBeenCalledWith('c1', 'ya no se usa');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_contrato.terminado', detalle: { motivo: 'ya no se usa' } }));
  });
  it('sin motivo válido no anota', async () => {
    dobles.terminar.mockResolvedValue({ ok: false, error: 'motivo' });
    const r = await accionTerminarContrato(null, forma({ id: 'c1', motivo: 'no' }));
    expect(r?.error).toContain('motivo');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });
  it('sin id no llama a la librería', async () => {
    const r = await accionTerminarContrato(null, forma({ motivo: 'ya no se usa' }));
    expect(r?.error).toBeTruthy();
    expect(dobles.terminar).not.toHaveBeenCalled();
  });
});

describe('guardas de forma', () => {
  it('«use server», getT dentro de cada acción y sin cerrar sobre el traductor', () => {
    const f = readFileSync('src/app/admin/back-office/contratos/acciones.ts', 'utf8');
    expect(f.startsWith("'use server'")).toBe(true);
    expect(f.match(/await getT\(/g)?.length).toBe(2);
    expect(f.match(/await requireSuperadmin\(\)/g)?.length).toBe(2);
  });
});
