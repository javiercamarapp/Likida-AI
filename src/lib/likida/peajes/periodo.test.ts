import { describe, it, expect } from 'vitest';
import {
  periodoDeNombreArchivo, UMBRAL_NO_PERIODO, periodoPorDecenaDominante, periodoPorNoPeriodo, esPeriodoInferido, rotuloOrigenPeriodo, resolverPeriodo, validarPeriodoDeclarado, limitesDelMes, mesAnterior, decenasDelMes, sumarMeses, diasEntre,
} from './periodo';

describe('periodoDeNombreArchivo: el rango ISO del conector del TMS (A2 ola 1)', () => {
  it('lee la ventana pedida a la API del nombre que el propio conector arma', () => {
    expect(periodoDeNombreArchivo('tms-peajes-2026-09-01-2026-09-10.csv')).toEqual({ desde: '2026-09-01', hasta: '2026-09-10', origen: 'nombre_archivo' });
  });
  it('un rango invertido o imposible no se adivina', () => {
    expect(periodoDeNombreArchivo('tms-peajes-2026-09-10-2026-09-01.csv')).toBeNull();
    expect(periodoDeNombreArchivo('tms-peajes-2026-13-01-2026-13-10.csv')).toBeNull();
  });
});

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

// ── A2 ola 1: inferir el periodo cuando el nombre no lo dice ────────────────
describe('periodoPorDecenaDominante / periodoPorNoPeriodo / resolverPeriodo (inferencia)', () => {
  const dias = (desde: number, hasta: number, n: number, mes = '2026-09') =>
    Array.from({ length: n }, (_, i) => `${mes}-${String(desde + (i % (hasta - desde + 1))).padStart(2, '0')}`);

  it('la decena donde cae casi todo el archivo; los extemporáneos (pocos, de antes) no la mueven', () => {
    const fechas = [...dias(11, 20, 200), '2026-09-02', '2026-09-05', '2026-08-28'];
    expect(periodoPorDecenaDominante(fechas)).toEqual({ desde: '2026-09-11', hasta: '2026-09-20', origen: 'decena_dominante' });
  });
  it('la tercera decena termina el último día del mes (fin de febrero también)', () => {
    expect(periodoPorDecenaDominante(dias(21, 28, 100, '2026-02'))).toMatchObject({ desde: '2026-02-21', hasta: '2026-02-28' });
    expect(periodoPorDecenaDominante(dias(21, 31, 100, '2026-10'))).toMatchObject({ desde: '2026-10-21', hasta: '2026-10-31' });
  });
  it('si ninguna decena domina (archivo de un mes entero) o hay muy pocas líneas: null, no se adivina', () => {
    expect(periodoPorDecenaDominante(dias(1, 30, 300))).toBeNull();
    expect(periodoPorDecenaDominante(dias(1, 10, 5))).toBeNull();
    expect(periodoPorDecenaDominante([null, null])).toBeNull();
  });
  it('por «No. de periodo»: cuenta decenas desde un archivo ancla de la misma flota (cruza de mes y de año)', () => {
    const ancla = { noPeriodo: 745, desde: '2026-09-01' };
    expect(periodoPorNoPeriodo('746', ancla, dias(11, 20, 100))).toEqual({ desde: '2026-09-11', hasta: '2026-09-20', origen: 'no_periodo' });
    expect(periodoPorNoPeriodo('748', ancla, dias(1, 10, 100, '2026-10'))).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-10' });
    expect(periodoPorNoPeriodo('744', { noPeriodo: 745, desde: '2026-01-01' }, dias(21, 31, 100, '2025-12'))).toMatchObject({ desde: '2025-12-21', hasta: '2025-12-31' });
  });
  it('el número solo se acepta si las fechas lo respaldan (la numeración del proveedor no está confirmada)', () => {
    const ancla = { noPeriodo: 745, desde: '2026-09-01' };
    expect(periodoPorNoPeriodo('746', ancla, dias(1, 10, 100, '2026-10'))).toBeNull();
    expect(periodoPorNoPeriodo('746', null, dias(11, 20, 100))).toBeNull();
    expect(periodoPorNoPeriodo('abc', ancla, dias(11, 20, 100))).toBeNull();
    expect(periodoPorNoPeriodo(null, ancla, dias(11, 20, 100))).toBeNull();
  });
  it('M5 · el No. de periodo exige el MISMO umbral que la decena dominante (≥ 85 %), nunca 50 %: una coincidencia de casualidad no asigna periodo', () => {
    expect(UMBRAL_NO_PERIODO).toBeGreaterThanOrEqual(0.85);
    const ancla = { noPeriodo: 745, desde: '2026-09-01' };
    const mezcla = (dentro: number, fuera: number) => [...dias(11, 20, dentro), ...dias(1, 10, fuera, '2026-10')];
    expect(periodoPorNoPeriodo('746', ancla, mezcla(55, 45))).toBeNull();   // 55 %: antes (≥ 50 %) se aceptaba
    expect(periodoPorNoPeriodo('746', ancla, mezcla(80, 20))).toBeNull();   // 80 %
    expect(periodoPorNoPeriodo('746', ancla, mezcla(84, 16))).toBeNull();   // 84 %
    expect(periodoPorNoPeriodo('746', ancla, mezcla(85, 15))).toMatchObject({ desde: '2026-09-11', hasta: '2026-09-20', origen: 'no_periodo' });
    expect(esPeriodoInferido('no_periodo')).toBe(true);                     // y sigue marcado como inferido
    // sin respaldo suficiente en fechas, resolverPeriodo cae a la decena dominante o a nada, nunca al número solo
    expect(resolverPeriodo({ nombreArchivo: 'reporte.xlsx', fechas: mezcla(55, 45), noPeriodo: '746', ancla })).toBeNull();
  });
  it('resolverPeriodo: declarado > nombre > No. de periodo > decena dominante > nada; lo inferido se marca como tal', () => {
    const fechas = dias(11, 20, 100);
    const ancla = { noPeriodo: 745, desde: '2026-09-01' };
    expect(resolverPeriodo({ declarado: { desde: '2026-09-01', hasta: '2026-09-10' }, nombreArchivo: '11 A 20 DE SEPT.xlsx', fechas, noPeriodo: '746', ancla })).toMatchObject({ origen: 'declarado' });
    expect(resolverPeriodo({ nombreArchivo: '11 A 20 DE SEPT.xlsx', fechas, noPeriodo: '746', ancla })).toMatchObject({ origen: 'nombre_archivo' });
    expect(resolverPeriodo({ nombreArchivo: 'reporte.xlsx', fechas, noPeriodo: '746', ancla })).toMatchObject({ origen: 'no_periodo' });
    expect(resolverPeriodo({ nombreArchivo: 'reporte.xlsx', fechas, noPeriodo: '746', ancla: null })).toMatchObject({ origen: 'decena_dominante' });
    expect(resolverPeriodo({ nombreArchivo: 'reporte.xlsx', fechas: dias(1, 30, 300) })).toBeNull();
    expect(esPeriodoInferido('no_periodo') && esPeriodoInferido('decena_dominante')).toBe(true);
    expect(esPeriodoInferido('declarado') || esPeriodoInferido('nombre_archivo') || esPeriodoInferido(null)).toBe(false);
  });
  it('el rótulo dice cómo se llegó al periodo y pide confirmar lo inferido', () => {
    expect(rotuloOrigenPeriodo('declarado')).toBe('declarado');
    expect(rotuloOrigenPeriodo('nombre_archivo')).toBe('tomado del nombre del archivo');
    expect(rotuloOrigenPeriodo('no_periodo')).toMatch(/inferido por el «No\. de periodo»: confírmalo/);
    expect(rotuloOrigenPeriodo('decena_dominante')).toMatch(/inferido por la decena/);
  });
});
