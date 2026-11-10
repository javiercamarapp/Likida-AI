import { beforeEach, describe, expect, it, vi } from 'vitest';

const bitacora = vi.hoisted(() => ({ anotar: vi.fn() }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: bitacora.anotar }));

import { anotarAccionAdmin, pasoExtraSuperadmin } from './acciones_riesgo';

beforeEach(() => vi.clearAllMocks());

describe('pasoExtraSuperadmin — reutiliza el step-up existente, no uno paralelo', () => {
  it('con la palanca apagada (D8, por omisión) pasa sin tocar Supabase', async () => {
    const sbDe = vi.fn(async () => { throw new Error('no debe llamarse'); });
    expect(await pasoExtraSuperadmin('dinero_saas', { userId: 'u-1' }, null, { env: {}, sbDe: sbDe as never })).toBeNull();
    expect(sbDe).not.toHaveBeenCalled();
  });

  it('encendida y sin factor TOTP inscrito: bloquea con el texto de la acción', async () => {
    const sb = { auth: { mfa: { listFactors: async () => ({ data: { totp: [] }, error: null }), getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] }, error: null }) } } };
    const m = await pasoExtraSuperadmin('dinero_saas', { userId: 'u-1' }, 'tn-1', { env: { LIKIDA_TOTP_ESCALONADO: 'obligatorio' }, sbDe: (async () => sb) as never });
    expect(m).toMatch(/segundo factor/);
    expect(m).toMatch(/suscripción de una flota/);
  });

  it('encendida y Supabase Auth caído: falla cerrado', async () => {
    const m = await pasoExtraSuperadmin('cambio_rol', { userId: 'u-1' }, null, {
      env: { LIKIDA_TOTP_ESCALONADO: 'obligatorio' }, sbDe: (async () => { throw new Error('caído'); }) as never,
    });
    expect(m).toMatch(/No pude comprobarlo/);
  });
});

describe('anotarAccionAdmin', () => {
  it('arma la entrada con actor, flota, entidad y detalle, y devuelve lo que diga el escritor', async () => {
    bitacora.anotar.mockResolvedValue(true);
    expect(await anotarAccionAdmin({
      actor: { userId: 'u-1' }, tenantId: 'tn-1', accion: 'suscripcion.pausada', entidad: 'suscripcion', entidadId: 's-1', detalle: { de: 'activa' },
    })).toBe(true);
    expect(bitacora.anotar.mock.calls[0][0]).toEqual({
      tenantId: 'tn-1', actor: { id: 'u-1', email: null }, accion: 'suscripcion.pausada', entidad: 'suscripcion', entidadId: 's-1', detalle: { de: 'activa' },
    });
    bitacora.anotar.mockResolvedValue(false);
    expect(await anotarAccionAdmin({ actor: { userId: 'u-1' }, tenantId: null, accion: 'x', entidad: 'plan', entidadId: 'p' })).toBe(false);
  });
});
