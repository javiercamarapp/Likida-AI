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
vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: async () => sesion }));

const A = await import('./acciones-control');
const fd = (c: Record<string, string> = {}) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };

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
