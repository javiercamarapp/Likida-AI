import { beforeEach, describe, expect, it, vi } from 'vitest';

const anotarBitacora = vi.fn(async () => true);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora }));
vi.mock('@/lib/correo/enviar', () => ({ correoConfigurado: () => false }));
vi.mock('@/lib/auth/usuarios_escritura', () => ({ enviarCorreoDeAcceso: vi.fn() }));

const { anotarAccionVendedor, correoDeAccesoDisponible } = await import('./vendedores_registro');

beforeEach(() => anotarBitacora.mockClear());

describe('bitácora de vendedores', () => {
  it('un movimiento se anota como acción de plataforma sobre el prospecto, con el rol del actor', async () => {
    await anotarAccionVendedor({ userId: 'u-1', rol: 'vendedor' }, 'prospecto.movido', 'p-1', { a: 'demo' });
    const [entrada] = anotarBitacora.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entrada).toMatchObject({
      tenantId: null, actor: { id: 'u-1', email: null }, accion: 'prospecto.movido', entidad: 'prospecto', entidadId: 'p-1',
      detalle: { a: 'demo', rol: 'vendedor' },
    });
  });

  it('una invitación se anota sobre el usuario (app_user)', async () => {
    await anotarAccionVendedor({ userId: 'u-s', rol: 'superadmin' }, 'vendedor.invitado', 'u-2', {});
    expect((anotarBitacora.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ entidad: 'app_user', entidadId: 'u-2' });
  });

  it('sin Resend configurado el alta se declara no disponible', () => {
    expect(correoDeAccesoDisponible()).toBe(false);
  });
});
