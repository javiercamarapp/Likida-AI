import { describe, it, expect } from 'vitest';
import {
  claseSchema, casetaSchema, unidadSchema, reglasCobroConfigSchema, REGLAS_COBRO_CONFIG_VACIA, validarExcepcionUnidad, validarJustificacion,
} from './reglas_cobro_config';

describe('la configuración de reglas de cobro (zod)', () => {
  it('la clase va de 1 a 12: rechaza 0, 13, decimales y texto', () => {
    for (const ok of [1, 5, 12]) expect(claseSchema.safeParse(ok).success).toBe(true);
    for (const mal of [0, 13, -1, 3.5, '3', null]) expect(claseSchema.safeParse(mal).success).toBe(false);
  });

  it('una caseta vacía o solo de espacios/signos se rechaza; el nombre se limpia', () => {
    expect(casetaSchema.safeParse('').success).toBe(false);
    expect(casetaSchema.safeParse('   ').success).toBe(false);
    expect(casetaSchema.safeParse('---').success).toBe(false);
    expect(casetaSchema.safeParse('x'.repeat(121)).success).toBe(false);
    expect(casetaSchema.parse('  Caseta   Ejemplo  ')).toBe('Caseta Ejemplo');
  });

  it('la unidad es obligatoria y de hasta 40 caracteres', () => {
    expect(unidadSchema.safeParse('').success).toBe(false);
    expect(unidadSchema.safeParse('u'.repeat(41)).success).toBe(false);
    expect(unidadSchema.parse(' TC9001 ')).toBe('TC9001');
  });

  it('la configuración nace vacía: sin clases, casetas ni excepciones por defecto', () => {
    expect(reglasCobroConfigSchema.parse({})).toEqual(REGLAS_COBRO_CONFIG_VACIA);
    expect(REGLAS_COBRO_CONFIG_VACIA).toEqual({ clasesValidas: [], excepcionesClase: [], casetasNoCruzar: [], excepcionesPorUnidad: [] });
  });

  it('rechaza una clase fuera de 1–12 y una caseta vacía dentro de la configuración completa', () => {
    expect(reglasCobroConfigSchema.safeParse({ clasesValidas: [3, 13] }).success).toBe(false);
    expect(reglasCobroConfigSchema.safeParse({ excepcionesClase: [{ caseta: 'Caseta Ejemplo', clases: [] }] }).success).toBe(false);
    expect(reglasCobroConfigSchema.safeParse({ casetasNoCruzar: [''] }).success).toBe(false);
    expect(reglasCobroConfigSchema.safeParse({ excepcionesPorUnidad: [{ caseta: 'Caseta Ejemplo', unidad: '' }] }).success).toBe(false);
    expect(reglasCobroConfigSchema.safeParse({
      clasesValidas: [3, 5], excepcionesClase: [{ caseta: 'Caseta Ejemplo', clases: [1] }], casetasNoCruzar: ['Caseta Ejemplo'],
      excepcionesPorUnidad: [{ caseta: 'Caseta Ejemplo', unidad: 'TC9001' }],
    }).success).toBe(true);
  });

  it('validarExcepcionUnidad normaliza las llaves y da un mensaje llano al fallar', () => {
    const v = validarExcepcionUnidad({ caseta: ' Caseta  Ejemplo Norte ', unidad: 'TC-9001', nota: '  rescates ' });
    expect(v).toEqual({ ok: true, valor: { caseta: 'Caseta Ejemplo Norte', casetaNorm: 'caseta ejemplo norte', unidad: 'TC-9001', unidadNorm: 'tc9001', nota: 'rescates' } });
    expect(validarExcepcionUnidad({ caseta: '', unidad: 'TC9001' })).toMatchObject({ ok: false, motivo: expect.stringContaining('caseta') });
    expect(validarExcepcionUnidad({ caseta: 'Caseta Ejemplo', unidad: ' ' })).toMatchObject({ ok: false, motivo: expect.stringContaining('unidad') });
  });

  it('validarJustificacion exige renglón válido y un motivo de al menos 3 caracteres', () => {
    expect(validarJustificacion({ indice: 4, motivo: ' Salida de servicio ' })).toEqual({ ok: true, valor: { indice: 4, motivo: 'Salida de servicio' } });
    expect(validarJustificacion({ indice: -1, motivo: 'motivo' }).ok).toBe(false);
    expect(validarJustificacion({ indice: 1.5, motivo: 'motivo' }).ok).toBe(false);
    expect(validarJustificacion({ indice: 1, motivo: 'ab' }).ok).toBe(false);
    expect(validarJustificacion({ indice: 1, motivo: '' }).ok).toBe(false);
    expect(validarJustificacion({ indice: 1, motivo: 'x'.repeat(301) }).ok).toBe(false);
  });
});
