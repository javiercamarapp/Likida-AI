import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  exigirStepUpAccion, rolConStepUp, topeSesionMfaMin, totpEscalonadoActivo, veredictoEscalonado, veredictoStepUp,
  ACCIONES_RIESGO, TOPE_SESION_MIN_POR_OMISION,
} from './stepup';

const ON = { LIKIDA_TOTP_ESCALONADO: 'obligatorio' };
const AHORA = Date.UTC(2026, 10, 4, 12, 0, 0);
const seg = (msAtras: number) => Math.floor((AHORA - msAtras) / 1000);

function sbCon(opts: { totp?: Array<{ id: string; status: string }>; aal?: string; metodos?: Array<{ method: string; timestamp: number }>; roto?: boolean }) {
  return async () => ({
    auth: {
      mfa: {
        listFactors: async () => (opts.roto ? { data: null, error: { message: '500' } } : { data: { totp: opts.totp ?? [] }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: opts.aal ?? 'aal1', currentAuthenticationMethods: opts.metodos ?? [] }, error: null,
        }),
      },
    },
  } as unknown as SupabaseClient);
}
const verificado = [{ id: 'f1', status: 'verified' }];

describe('palanca y tope', () => {
  it('apagado por omisión', () => {
    expect(totpEscalonadoActivo({})).toBe(false);
    expect(totpEscalonadoActivo({ LIKIDA_TOTP_ESCALONADO: 'si' })).toBe(false);
    expect(totpEscalonadoActivo(ON)).toBe(true);
  });
  it('tope: omisión, acotado y tolerante a basura', () => {
    expect(topeSesionMfaMin({})).toBe(TOPE_SESION_MIN_POR_OMISION);
    expect(topeSesionMfaMin({ LIKIDA_MFA_TOPE_SESION_MIN: 'x' })).toBe(TOPE_SESION_MIN_POR_OMISION);
    expect(topeSesionMfaMin({ LIKIDA_MFA_TOPE_SESION_MIN: '1' })).toBe(15);
    expect(topeSesionMfaMin({ LIKIDA_MFA_TOPE_SESION_MIN: '99999' })).toBe(1440);
    expect(topeSesionMfaMin({ LIKIDA_MFA_TOPE_SESION_MIN: '60' })).toBe(60);
  });
  it('solo dueño y contador', () => {
    expect(rolConStepUp('flota_admin')).toBe(true);
    expect(rolConStepUp('contador')).toBe(true);
    expect(rolConStepUp('encargado')).toBe(false);
    expect(rolConStepUp(null)).toBe(false);
  });
});

describe('veredictoEscalonado (pura)', () => {
  const base = { legible: true, inscrito: true, aal: 'aal2', totpVerificadoEn: seg(10 * 60_000) };
  it('reciente pasa', () => expect(veredictoEscalonado(base, AHORA, 60)).toBe('ok'));
  it('vencido pide el código', () => expect(veredictoEscalonado({ ...base, totpVerificadoEn: seg(61 * 60_000) }, AHORA, 60)).toBe('retar'));
  it('AAL1 pide el código', () => expect(veredictoEscalonado({ ...base, aal: 'aal1' }, AHORA, 60)).toBe('retar'));
  it('sin factor pide inscribir (aquí no hay incrementalidad)', () => expect(veredictoEscalonado({ ...base, inscrito: false }, AHORA, 60)).toBe('inscribir'));
  it('ilegible cierra', () => expect(veredictoEscalonado({ ...base, legible: false }, AHORA, 60)).toBe('no_verificable'));
  it('AAL2 sin marca de tiempo no se prueba reciente', () => expect(veredictoEscalonado({ ...base, totpVerificadoEn: null }, AHORA, 60)).toBe('retar'));
  it('marca en el futuro lejano cierra', () => expect(veredictoEscalonado({ ...base, totpVerificadoEn: seg(-3_600_000) }, AHORA, 60)).toBe('retar'));
});

describe('veredictoStepUp / exigirStepUpAccion', () => {
  it('apagado: ok sin tocar Supabase', async () => {
    let tocado = false;
    const v = await veredictoStepUp('flota_admin', { env: {}, sbDe: async () => { tocado = true; throw new Error('no'); } });
    expect(v).toBe('ok');
    expect(tocado).toBe(false);
  });
  it('rol fuera del alcance: ok sin tocar Supabase', async () => {
    expect(await veredictoStepUp('encargado', { env: ON, sbDe: async () => { throw new Error('no'); } })).toBe('ok');
  });
  it('usuario sin factor: bloqueo en las cuatro acciones', async () => {
    for (const a of ACCIONES_RIESGO) {
      const m = await exigirStepUpAccion('contador', a, {}, { env: ON, ahoraMs: AHORA, sbDe: sbCon({ totp: [] }) });
      expect(m).toMatch(/segundo factor/);
      expect(m).toMatch(/Inscríbelo/);
    }
  });
  it('token AAL1 contra acción AAL2: bloqueo', async () => {
    const m = await exigirStepUpAccion('flota_admin', 'emitir_cfdi', {}, { env: ON, ahoraMs: AHORA, sbDe: sbCon({ totp: verificado, aal: 'aal1' }) });
    expect(m).toMatch(/código de tu app/);
  });
  it('con factor, AAL2 reciente: pasa', async () => {
    const sb = sbCon({ totp: verificado, aal: 'aal2', metodos: [{ method: 'otp', timestamp: seg(9e6) }, { method: 'totp', timestamp: seg(5 * 60_000) }] });
    expect(await exigirStepUpAccion('flota_admin', 'llave_api', {}, { env: ON, ahoraMs: AHORA, sbDe: sb })).toBeNull();
  });
  it('con factor, AAL2 vencido: bloqueo por tope', async () => {
    const sb = sbCon({ totp: verificado, aal: 'aal2', metodos: [{ method: 'totp', timestamp: seg(13 * 3_600_000) }] });
    expect(await exigirStepUpAccion('flota_admin', 'cambio_rol', {}, { env: ON, ahoraMs: AHORA, sbDe: sb })).toMatch(/Escribe el código/);
  });
  it('Supabase roto o lanzando: falla cerrado', async () => {
    expect(await exigirStepUpAccion('contador', 'exporte_dinero', {}, { env: ON, sbDe: sbCon({ roto: true }) })).toMatch(/No pude comprobarlo/);
    expect(await exigirStepUpAccion('contador', 'exporte_dinero', {}, { env: ON, sbDe: async () => { throw new Error('x'); } })).toMatch(/No pude comprobarlo/);
  });
});
