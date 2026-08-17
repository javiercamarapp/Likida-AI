import { describe, expect, it } from 'vitest';
import { estadoMfa, exigirAal2SiHayFactor } from './mfa';
import type { SupabaseClient } from '@supabase/supabase-js';

function sbCon(totp: Array<{ id: string; status: string }>, aal: string | null) {
  return {
    auth: {
      mfa: {
        listFactors: async () => ({ data: { totp }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: aal ? { currentLevel: aal } : null, error: null }),
      },
    },
  } as unknown as SupabaseClient;
}

describe('estadoMfa', () => {
  it('con factor verificado: inscrito, con su id', async () => {
    const e = await estadoMfa(sbCon([{ id: 'f1', status: 'verified' }], 'aal1'));
    expect(e).toMatchObject({ inscrito: true, factorId: 'f1', aal: 'aal1' });
  });
  it('factor a medias NO cuenta como inscrito, pero se lista para limpiarlo', async () => {
    const e = await estadoMfa(sbCon([{ id: 'f2', status: 'unverified' }], 'aal1'));
    expect(e.inscrito).toBe(false);
    expect(e.sinVerificar).toEqual(['f2']);
  });
});

describe('exigirAal2SiHayFactor — la política incremental', () => {
  it('sin factor: pasa (no se exige lo que no existe)', async () => {
    expect(await exigirAal2SiHayFactor(sbCon([], 'aal1'))).toEqual({ ok: true });
  });
  it('con factor y sesión AAL1: se exige verificar', async () => {
    expect(await exigirAal2SiHayFactor(sbCon([{ id: 'f1', status: 'verified' }], 'aal1')))
      .toEqual({ ok: false, motivo: 'verificar' });
  });
  it('con factor y sesión AAL2: pasa', async () => {
    expect(await exigirAal2SiHayFactor(sbCon([{ id: 'f1', status: 'verified' }], 'aal2')))
      .toEqual({ ok: true });
  });
});
