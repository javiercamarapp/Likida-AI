import { afterEach, describe, expect, it } from 'vitest';
import { datoLegal, estadoLegalProduccion, exigirLegalEnProduccion, LEGAL_PLACEHOLDERS } from './config';

describe('gate legal enterprise', () => {
  afterEach(() => { delete process.env.LEGAL_ENFORCE_PRODUCTION; });

  it('no inventa identidad y expone pendientes', () => {
    const estado = estadoLegalProduccion();
    expect(estado.listo).toBe(false);
    expect(estado.bloqueado).toBe(true);
    expect(estado.faltantes).toContain('LEGAL_ENTITY_NAME');
    expect(estado.faltantes).toContain('LEGAL_CONTACT_EMAIL');
    expect(LEGAL_PLACEHOLDERS.razonSocial).toContain('[COMPLETAR:');
  });

  it('un placeholder no cuenta como configuración legal real', () => {
    expect(datoLegal(' [COMPLETAR: razón social] ')).toBeNull();
    expect(datoLegal('PENDIENTE')).toBeNull();
    expect(datoLegal('Likida Operaciones, S.A.P.I. de C.V.')).toContain('Likida Operaciones');
  });

  it('bloquea explícitamente cuando se exige producción', () => {
    process.env.LEGAL_ENFORCE_PRODUCTION = 'true';
    expect(() => exigirLegalEnProduccion()).toThrow('LEGAL_PRODUCTION_BLOCKED');
  });
});
