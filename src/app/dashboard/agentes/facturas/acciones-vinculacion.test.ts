import { describe, it, expect, vi, beforeEach } from 'vitest';

// Corrección L1J: el módulo 'use server' no tenía ninguna prueba que lo importara (un `const r` repetido pasó el vitest
// y rompía el build). Esta prueba ejecuta de verdad las tres acciones con la puerta de flota pintada.

const vinc = vi.hoisted(() => ({ iniciarVinculacion: vi.fn(), cancelarVinculacion: vi.fn(), estadoVisible: vi.fn(), listar: vi.fn() }));
vi.mock('@/lib/likida/autofactura/vinculacion_remota', () => ({
  iniciarVinculacion: vinc.iniciarVinculacion, cancelarVinculacion: vinc.cancelarVinculacion, estadoVisible: vinc.estadoVisible,
}));
vi.mock('@/lib/likida/autofactura/vinculacion_remota_repo', () => ({ crearDepsVinculacion: () => ({ repo: { listar: vinc.listar } }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
let sesion: { rol: string; tenantId: string; userId: string } = { rol: 'flota_admin', tenantId: 't-1', userId: 'u-1' };
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => ({ ...sesion, tenantId: sesion.rol === 'superadmin' ? null : sesion.tenantId }) }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({
  resolverTenantEfectivo: async (_d: string, sp?: { tenant?: string }) => ({ ...sesion, tenantId: sp?.tenant ?? sesion.tenantId, rolReal: sesion.rol }),
}));

process.env.LIKIDA_FLOTA_COOKIE_LLAVE = 'llave-de-prueba-0123456789';
const { firmarFlotaPintada, CAMPO_FLOTA_PINTADA } = await import('@/lib/auth/tenant-atado');
const A = await import('./acciones-vinculacion');
const fd = (c: Record<string, string> = {}, flota: string | null = sesion.tenantId) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(c)) f.set(k, v);
  if (flota) f.set(CAMPO_FLOTA_PINTADA, firmarFlotaPintada(flota, sesion.userId)!);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  sesion = { rol: 'flota_admin', tenantId: 't-1', userId: 'u-1' };
});

describe('acciones de vinculación asistida', () => {
  it('iniciar: con la flota pintada firmada llega a iniciarVinculacion con tenant y usuario de la sesión', async () => {
    vinc.iniciarVinculacion.mockResolvedValue({ ok: true, codigo: 'ABC', comando: 'cmd', expiraEn: 'x', comercio: 'enerser', nombre: 'Enerser' });
    const r = await A.accionIniciarVinculacion(null, fd({ comercio: 'enerser' }));
    expect(r).toMatchObject({ ok: true, codigo: 'ABC' });
    expect(vinc.iniciarVinculacion).toHaveBeenCalledWith({ tenantId: 't-1', userId: 'u-1', comercio: 'enerser' }, expect.anything());
  });
  it('iniciar: el superadmin sin campo firmado se niega y no toca la base', async () => {
    sesion = { rol: 'superadmin', tenantId: 't-1', userId: 'u-1' };
    const r = await A.accionIniciarVinculacion(null, fd({ comercio: 'enerser' }, null));
    expect(r).toMatchObject({ ok: false });
    expect(vinc.iniciarVinculacion).not.toHaveBeenCalled();
  });
  it('iniciar: una flota pintada distinta de la de la sesión se niega', async () => {
    const r = await A.accionIniciarVinculacion(null, fd({ comercio: 'enerser' }, 't-otra'));
    expect(r).toMatchObject({ ok: false });
    expect(vinc.iniciarVinculacion).not.toHaveBeenCalled();
  });
  it('iniciar: un motivo del dominio se devuelve como error', async () => {
    vinc.iniciarVinculacion.mockResolvedValue({ ok: false, motivo: 'ya hay una en curso' });
    expect(await A.accionIniciarVinculacion(null, fd({ comercio: 'enerser' }))).toEqual({ ok: false, error: 'ya hay una en curso' });
  });
  it('cancelar: el dueño cancela con firma; el superadmin sin firma no', async () => {
    vinc.cancelarVinculacion.mockResolvedValue(1);
    expect(await A.accionCancelarVinculacion(null, fd({ comercio: 'enerser' }))).toHaveProperty('ok');
    expect(vinc.cancelarVinculacion).toHaveBeenCalledTimes(1);
    sesion = { rol: 'superadmin', tenantId: 't-1', userId: 'u-1' };
    expect(await A.accionCancelarVinculacion(null, fd({ comercio: 'enerser' }, null))).toHaveProperty('error');
    expect(vinc.cancelarVinculacion).toHaveBeenCalledTimes(1);
  });
  it('estado: el superadmin sin firma responde ok:false sin leer la base', async () => {
    sesion = { rol: 'superadmin', tenantId: 't-1', userId: 'u-1' };
    expect(await A.accionEstadoVinculacion('enerser', null)).toEqual({ ok: false });
    expect(vinc.listar).not.toHaveBeenCalled();
  });
});
