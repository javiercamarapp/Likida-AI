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

  it('LEGAL-19C2-A7: una razón social real que CONTIENE la palabra de un placeholder no se rechaza', () => {
    // Antes: `\btodo\b` (o "completar"/"pendiente"/"tbd") en cualquier
    // parte del texto bastaba para descartarlo como si fuera un placeholder
    // sin llenar.
    expect(datoLegal('Grupo Todo Carga SA de CV')).toBe('Grupo Todo Carga SA de CV');
    expect(datoLegal('Transportes Pendiente de Registro SA')).toBe('Transportes Pendiente de Registro SA');
  });

  it('bloquea explícitamente cuando se exige producción', () => {
    process.env.LEGAL_ENFORCE_PRODUCTION = 'true';
    expect(() => exigirLegalEnProduccion()).toThrow('LEGAL_PRODUCTION_BLOCKED');
  });
});
