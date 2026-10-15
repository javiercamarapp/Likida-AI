import { describe, it, expect } from 'vitest';
import {
  periodoDeNombreArchivo, resolverPeriodo, validarPeriodoDeclarado, limitesDelMes, mesAnterior, decenasDelMes, sumarMeses, diasEntre,
} from './periodo';

describe('periodoDeNombreArchivo', () => {
  it('«01 A 10 DE SEPT» con el año deducido de las fechas del archivo', () => {
    const fechas = ['2026-09-03', '2026-09-08', '2026-08-30']; // un extemporáneo de agosto no cambia el año
    expect(periodoDeNombreArchivo('01 A 10 DE SEPT.xlsx', fechas)).toEqual({ desde: '2026-09-01', hasta: '2026-09-10', origen: 'nombre_archivo' });
    expect(periodoDeNombreArchivo('21 A 30 DE SEPT.xlsx', fechas)).toMatchObject({ desde: '2026-09-21', hasta: '2026-09-30' });
  });
  it('trae el año en el nombre y no lo pregunta a las fechas', () => {
    expect(periodoDeNombreArchivo('Estado del 11 al 20 de septiembre de 2025.xlsx', [])).toMatchObject({ desde: '2025-09-11', hasta: '2025-09-20' });
    expect(periodoDeNombreArchivo('21-31 oct 2026.csv', [])).toMatchObject({ desde: '2026-10-21', hasta: '2026-10-31' });
  });
  it('«21 A 31» en un mes de 30 días se acota al fin de mes; fechas imposibles se rechazan', () => {
    expect(periodoDeNombreArchivo('21 A 31 DE SEPT 2026.xlsx', [])).toMatchObject({ hasta: '2026-09-30' });
    expect(periodoDeNombreArchivo('31 A 10 DE SEPT 2026.xlsx', [])).toBeNull(); // desde > hasta
    expect(periodoDeNombreArchivo('30 A 31 DE FEB 2026.xlsx', [])).toBeNull();  // 30-feb no existe
  });
  it('NO inventa: sin año deducible, sin mes o sin rango devuelve null', () => {
    expect(periodoDeNombreArchivo('01 A 10 DE SEPT.xlsx', [])).toBeNull();      // sin año ni fechas
    expect(periodoDeNombreArchivo('estado_de_cuenta.xlsx', ['2026-09-01'])).toBeNull();
    expect(periodoDeNombreArchivo('01 A 10 DE XYZ.xlsx', ['2026-09-01'])).toBeNull();
  });
});

describe('resolverPeriodo y validación', () => {
  it('lo declarado manda sobre el nombre', () => {
    expect(resolverPeriodo({ declarado: { desde: '2026-09-02', hasta: '2026-09-09' }, nombreArchivo: '01 A 10 DE SEPT.xlsx', fechas: ['2026-09-05'] }))
      .toEqual({ desde: '2026-09-02', hasta: '2026-09-09', origen: 'declarado' });
  });
  it('un periodo declarado inválido cae al nombre; sin nada, null', () => {
    expect(resolverPeriodo({ declarado: { desde: '2026-09-10', hasta: '2026-09-01' }, nombreArchivo: '01 A 10 DE SEPT.xlsx', fechas: ['2026-09-05'] })?.origen).toBe('nombre_archivo');
    expect(resolverPeriodo({ nombreArchivo: 'x.xlsx', fechas: [] })).toBeNull();
  });
  it('valida fechas del calendario', () => {
    expect(validarPeriodoDeclarado('2026-02-30', '2026-03-01').ok).toBe(false);
    expect(validarPeriodoDeclarado('2026-03-01', '2026-03-10').ok).toBe(true);
    expect(validarPeriodoDeclarado('hola', '2026-03-10').ok).toBe(false);
  });
});

describe('calendario', () => {
  it('meses, decenas y plazos', () => {
    expect(limitesDelMes('2026-02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(limitesDelMes('2028-02')?.hasta).toBe('2028-02-29');
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(decenasDelMes('2026-09').map((d) => d.etiqueta)).toEqual(['1 a 10', '11 a 20', '21 a 30']);
    expect(decenasDelMes('2026-10')[2].hasta).toBe('2026-10-31');
    expect(sumarMeses('2026-11-30', 3)).toBe('2027-02-28');
    expect(sumarMeses('2026-08-31', 3)).toBe('2026-11-30');
    expect(diasEntre('2026-09-01', '2026-09-30')).toBe(29);
  });
});
