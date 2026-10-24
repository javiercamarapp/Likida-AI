import { describe, it, expect } from 'vitest';
import { validarRef } from './ref-produccion';
import { PRODUCTION_REF, STAGING_REF } from '../ci/production-candidate.mjs';

describe('A37-S02-07 validarRef', () => {
  it('sin --ref explícito: se niega aunque .env.local traiga uno', () => {
    expect(validarRef([], PRODUCTION_REF).ok).toBe(false);
  });
  it('--ref de staging: se niega', () => {
    expect(validarRef([`--ref=${STAGING_REF}`], STAGING_REF).ok).toBe(false);
  });
  it('.env.local de staging con --ref de producción: se niega', () => {
    const r = validarRef([`--ref=${PRODUCTION_REF}`], STAGING_REF);
    expect(r.ok).toBe(false);
  });
  it('producción explícita y coincidente: pasa', () => {
    expect(validarRef([`--ref=${PRODUCTION_REF}`], PRODUCTION_REF)).toEqual({ ok: true, ref: PRODUCTION_REF });
  });
});
