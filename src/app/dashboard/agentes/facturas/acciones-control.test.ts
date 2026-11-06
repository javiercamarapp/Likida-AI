import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S13-09: la base reserva ENCENDER la emisión real, CAMBIAR LÍMITES y PROMOVER un portal a autónomo al dueño (flota_admin).
// Antes la acción solo pedía «ver dinero» (el contador también) y el RPC lo rechazaba dejando intentos fallidos en bitácora.

const repo = vi.hoisted(() => ({
  encenderEmisionReal: vi.fn(), apagarEmisionReal: vi.fn(), cambiarLimites: vi.fn(),
  decidirLote: vi.fn(), promoverPortal: vi.fn(), devolverASupervisada: vi.fn(),
}));
vi.mock('@/lib/likida/autofactura/control_emision_repo', () => repo);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
let sesion: { rol: string; tenantId: string; userId: string } = { rol: 'flota_admin', tenantId: 't-1', userId: 'u-1' };
// MX-002: las acciones leen la flota que la pantalla pintó (campo firmado) y la cruzan con la sesión real.
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => ({ ...sesion, tenantId: sesion.rol === 'superadmin' ? null : sesion.tenantId }) }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({
  resolverTenantEfectivo: async (_d: string, sp?: { tenant?: string }) => ({ ...sesion, tenantId: sp?.tenant ?? sesion.tenantId, rolReal: sesion.rol }),
}));

process.env.LIKIDA_FLOTA_COOKIE_LLAVE = 'llave-de-prueba-0123456789';
const { firmarFlotaPintada, CAMPO_FLOTA_PINTADA } = await import('@/lib/auth/tenant-atado');
const A = await import('./acciones-control');
/** Un formulario como lo envía la pantalla: con la flota pintada firmada para el usuario actual. */
const fd = (c: Record<string, string> = {}, flota: string | null = sesion.tenantId) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(c)) f.set(k, v);
  if (flota) f.set(CAMPO_FLOTA_PINTADA, firmarFlotaPintada(flota, sesion.userId)!);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of Object.values(repo)) f.mockResolvedValue({ ok: true, mensaje: 'listo' });
});

describe('A37-S13-09: lo que es del dueño no se ofrece ni se ejecuta para el contador', () => {
  const SOLO_DUENO: Array<[string, () => Promise<unknown>, keyof typeof repo]> = [
    ['encender', () => A.accionEncenderEmision(null, fd()), 'encenderEmisionReal'],
    ['cambiar límites', () => A.accionCambiarLimites(null, fd({ maxMontoTicket: '1500', maxTicketsLote: '5', maxTicketsDia: '20', maxMontoDia: '20000' })), 'cambiarLimites'],
    ['promover portal', () => A.accionPromoverPortal(null, fd({ comercio: 'enerser' })), 'promoverPortal'],
  ];
  it.each(SOLO_DUENO)('%s: el contador recibe el rechazo y la base NO se toca', async (_n, llamar, fn) => {
    sesion = { rol: 'contador', tenantId: 't-1', userId: 'u-2' };
    expect(await llamar()).toMatchObject({ error: expect.stringMatching(/dueño/i) });
    expect(repo[fn]).not.toHaveBeenCalled();
  });
  it.each(SOLO_DUENO)('%s: el dueño (y el superadmin) sí llegan al RPC', async (_n, llamar, fn) => {
    for (const rol of ['flota_admin', 'superadmin']) {
      repo[fn].mockClear();
      sesion = { rol, tenantId: 't-1', userId: 'u-1' };
      expect(await llamar()).toMatchObject({ ok: 'listo' });
      expect(repo[fn]).toHaveBeenCalledTimes(1);
    }
  });
  it('lo que la base sí permite al contador (apagar, decidir lote, devolver a supervisada) sigue funcionando', async () => {
    sesion = { rol: 'contador', tenantId: 't-1', userId: 'u-2' };
    expect(await A.accionApagarEmision(null, fd())).toMatchObject({ ok: 'listo' });
    expect(await A.accionDecidirLote(null, fd({ loteId: 'l1', decision: 'rechazar' }))).toMatchObject({ ok: 'listo' });
    expect(await A.accionDevolverPortal(null, fd({ comercio: 'enerser' }))).toMatchObject({ ok: 'listo' });
  });
  it('un rol sin acceso a dinero no puede nada', async () => {
    sesion = { rol: 'encargado', tenantId: 't-1', userId: 'u-3' };
    expect(await A.accionApagarEmision(null, fd())).toMatchObject({ error: expect.any(String) });
    expect(repo.apagarEmisionReal).not.toHaveBeenCalled();
  });
});

describe('MX-002: emitir/decidir solo en la flota que la pantalla pintó', () => {
  it('superadmin con dos pestañas: el formulario de la flota t-1 escribe en t-1 aunque la cookie diga otra', async () => {
    sesion = { rol: 'superadmin', tenantId: 't-otra-por-cookie', userId: 'u-0' };
    expect(await A.accionEncenderEmision(null, fd({}, 't-1'))).toMatchObject({ ok: 'listo' });
    expect(repo.encenderEmisionReal).toHaveBeenCalledWith('t-1', 'u-0');
  });
  it('superadmin SIN la flota firmada (POST armado a mano): se niega y la base NO se toca', async () => {
    sesion = { rol: 'superadmin', tenantId: 't-1', userId: 'u-0' };
    expect(await A.accionEncenderEmision(null, fd({}, null))).toMatchObject({ error: expect.stringMatching(/No se guardó nada/) });
    expect(await A.accionDecidirLote(null, fd({ loteId: 'l1', decision: 'confirmar' }, null))).toMatchObject({ error: expect.stringMatching(/No se guardó nada/) });
    expect(repo.encenderEmisionReal).not.toHaveBeenCalled();
    expect(repo.decidirLote).not.toHaveBeenCalled();
  });
  it('un dueño no puede mandar la firma de OTRA flota para escribir en ella', async () => {
    sesion = { rol: 'flota_admin', tenantId: 't-1', userId: 'u-1' };
    expect(await A.accionEncenderEmision(null, fd({}, 't-2'))).toMatchObject({ error: expect.stringMatching(/No se guardó nada/) });
    expect(repo.encenderEmisionReal).not.toHaveBeenCalled();
  });
});
