import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), anotar: vi.fn(), crear: vi.fn(), desactivar: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ anotarAccionAdmin: dobles.anotar, AVISO_SIN_BITACORA: ' [SIN BITACORA]' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/backoffice/contratistas', () => ({ crearContratista: dobles.crear, desactivarContratista: dobles.desactivar }));

import { accionCrearContratista, accionDesactivarContratista } from './acciones';

const forma = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1' });
  dobles.anotar.mockReset().mockResolvedValue(true);
  dobles.crear.mockReset().mockResolvedValue({ ok: true, id: 'p1' });
  dobles.desactivar.mockReset().mockResolvedValue({ ok: true, id: 'p1' });
});

describe('contratistas: acciones', () => {
  it('crear anota bo_contratista.creado sin RFC en el detalle', async () => {
    const r = await accionCrearContratista(null, forma({ nombre: 'Ana', esquema: 'comision', rfc: 'XAXX010101000' }));
    expect(r?.ok).toContain('Ana');
    const llamada = dobles.anotar.mock.calls[0][0];
    expect(llamada).toMatchObject({ accion: 'bo_contratista.creado', entidad: 'bo_contratista', entidadId: 'p1' });
    expect(JSON.stringify(llamada.detalle)).not.toContain('XAXX');
  });
  it('un RFC malo se dice en pantalla y no se anota', async () => {
    dobles.crear.mockResolvedValue({ ok: false, error: 'rfc' });
    const r = await accionCrearContratista(null, forma({ nombre: 'Ana', esquema: 'comision', rfc: 'MAL' }));
    expect(r?.error).toContain('dígito verificador');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });
  it('desactivar anota bo_contratista.desactivado; sin id no hace nada', async () => {
    await accionDesactivarContratista(null, forma({ id: 'p1' }));
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_contratista.desactivado' }));
    const r = await accionDesactivarContratista(null, forma({}));
    expect(r?.error).toBeTruthy();
    expect(dobles.desactivar).toHaveBeenCalledTimes(1);
  });
  it('la puerta de superadmin va primero', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(accionCrearContratista(null, forma({ nombre: 'Ana', esquema: 'comision' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.crear).not.toHaveBeenCalled();
  });
});
