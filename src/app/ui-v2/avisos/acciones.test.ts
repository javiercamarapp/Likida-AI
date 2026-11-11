import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  marcar: vi.fn(),
  guardarPref: vi.fn(),
  avisosAdmin: vi.fn(),
  guard: vi.fn(),
  tenant: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ db: true }) }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.guard }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: d.tenant }));
vi.mock('@/app/ui-v2/avisos/fuente-admin', () => ({ leerAvisosAdmin: d.avisosAdmin }));
vi.mock('@/app/ui-v2/avisos/fuente-flota', () => ({ leerAvisosFlota: vi.fn() }));
vi.mock('@/lib/avisos/estado', () => ({ marcarLeidas: d.marcar, guardarPreferencia: d.guardarPref, guardarSilencio: vi.fn() }));

const { marcarAvisos, guardarPreferenciaAviso } = await import('./acciones');

beforeEach(() => {
  vi.clearAllMocks();
  d.guard.mockResolvedValue({ userId: 'u-super' });
  d.tenant.mockResolvedValue({ tenantId: 't-1', userId: 'u-1', rol: 'flota_admin' });
  d.avisosAdmin.mockResolvedValue({ avisos: [
    { clave: 'talachas|2', silenciable: true }, { clave: 'arco|2', silenciable: false },
  ], generadoEn: 'x' });
  d.marcar.mockResolvedValue({ ok: true, cambiadas: 1 });
  d.guardarPref.mockResolvedValue({ ok: true });
});

describe('marcarAvisos', () => {
  it('marcar solo escribe claves vigentes y silenciables (no un plazo legal ni una clave inventada)', async () => {
    const r = await marcarAvisos({ panel: 'admin' }, ['talachas|2', 'arco|2', 'inventada'], true);
    expect(r).toEqual({ ok: true, cambiadas: 1 });
    expect(d.marcar).toHaveBeenCalledWith({ db: true }, { tipo: 'admin' }, ['talachas|2'], true);
  });
  it('desmarcar acepta cualquier clave propia (una vieja también se puede limpiar)', async () => {
    await marcarAvisos({ panel: 'admin' }, ['vieja|1', 'talachas|2'], false);
    expect(d.marcar).toHaveBeenCalledWith({ db: true }, { tipo: 'admin' }, ['vieja|1', 'talachas|2'], false);
  });
  it('el ámbito lo decide el servidor: en el panel del cliente es la flota resuelta, no lo que diga el navegador', async () => {
    await marcarAvisos({ panel: 'flota', tenant: 'otra-flota' }, ['x'], false);
    expect(d.tenant).toHaveBeenCalledWith('/dashboard/notificaciones', { tenant: 'otra-flota' });
    expect(d.marcar.mock.calls[0][1]).toEqual({ tipo: 'flota', tenantId: 't-1' });
  });
  it('rechaza una petición mal formada y propaga el error de la base', async () => {
    expect(await marcarAvisos({ panel: 'admin' }, 'x' as never, true)).toEqual({ ok: false, error: 'peticion_invalida' });
    d.marcar.mockResolvedValue({ ok: false, error: 'rls' });
    expect(await marcarAvisos({ panel: 'admin' }, ['talachas|2'], true)).toEqual({ ok: false, error: 'rls' });
  });
});

describe('guardarPreferenciaAviso', () => {
  it('valida contra el catálogo del ámbito y guarda para la persona de la sesión', async () => {
    expect(await guardarPreferenciaAviso({ panel: 'admin' }, 'dinero', 'app', true)).toEqual({ ok: false, error: 'fuera_catalogo' });
    expect(await guardarPreferenciaAviso({ panel: 'admin' }, 'costos', 'app', false)).toEqual({ ok: true });
    expect(d.guardarPref).toHaveBeenCalledWith({ db: true }, { tipo: 'admin' }, 'u-super', 'costos', 'app', false);
  });
});
