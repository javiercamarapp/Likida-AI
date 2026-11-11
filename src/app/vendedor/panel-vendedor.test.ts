import { beforeEach, describe, expect, it, vi } from 'vitest';

let sesion: { userId: string; tenantId: string | null; rol: string; nombre: string | null } | null = null;
let veredicto: 'ok' | 'inscribir' | 'retar' | 'no_verificable' = 'ok';

vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/auth/superadmin-mfa', () => ({ veredictoMfaDeSesion: async () => veredicto }));
const anotar = vi.fn(async () => undefined);
vi.mock('@/lib/likida/vendedores_registro', () => ({ anotarAccionVendedor: anotar }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { ejecutarComoVendedor } = await import('./panel-vendedor');

describe('acciones mutantes de /vendedor', () => {
  beforeEach(() => {
    sesion = { userId: 'u-v', tenantId: null, rol: 'vendedor', nombre: 'V' };
    veredicto = 'ok';
  });

  it('el vendedor normal conserva el ancla a su userId', async () => {
    const mutar = vi.fn(async () => undefined);
    await expect(ejecutarComoVendedor(mutar, 'probar')).resolves.toEqual({ ok: true });
    expect(mutar).toHaveBeenCalledWith({ soloDeVendedor: 'u-v' });
  });

  it.each(['inscribir', 'retar', 'no_verificable'] as const)(
    'superadmin con veredicto %s: no ejecuta la mutación',
    async (resultado) => {
      sesion = { userId: 'u-s', tenantId: null, rol: 'superadmin', nombre: 'S' };
      veredicto = resultado;
      const mutar = vi.fn(async () => undefined);
      const r = await ejecutarComoVendedor(mutar, 'probar');
      expect(r.ok).toBe(false);
      expect(mutar).not.toHaveBeenCalled();
    },
  );

  it('superadmin AAL2 sí ejecuta la mutación sin ancla de vendedor', async () => {
    sesion = { userId: 'u-s', tenantId: null, rol: 'superadmin', nombre: 'S' };
    const mutar = vi.fn(async () => undefined);
    await expect(ejecutarComoVendedor(mutar, 'probar')).resolves.toEqual({ ok: true });
    expect(mutar).toHaveBeenCalledWith({});
  });

  it('con registro, una acción exitosa deja su anotación firmada por la SESIÓN', async () => {
    anotar.mockClear();
    const mutar = vi.fn(async () => undefined);
    await ejecutarComoVendedor(mutar, 'probar', { accion: 'prospecto.movido', entidadId: 'p-1', detalle: { a: 'demo' } });
    expect(anotar).toHaveBeenCalledWith({ userId: 'u-v', rol: 'vendedor' }, 'prospecto.movido', 'p-1', { a: 'demo' });
  });

  it('si la acción falla no se anota nada', async () => {
    anotar.mockClear();
    const mutar = vi.fn(async () => { throw new Error('x'); });
    const r = await ejecutarComoVendedor(mutar, 'probar', { accion: 'prospecto.nota', entidadId: 'p-1', detalle: {} });
    expect(r.ok).toBe(false);
    expect(anotar).not.toHaveBeenCalled();
  });
});
