import { describe, it, expect } from 'vitest';
import { matrizDeCsv } from './csv';
import {
  parsearTarifasMatriz, planificarTarifa, validarTarifaEntrada, vigenciasSeTraslapan, claseDeCelda,
  type TarifaExistente, type TarifaEntrada,
} from './tarifario_archivo';

const csv = (t: string) => matrizDeCsv(new TextEncoder().encode(t));
const leer = (t: string, desdePorDefecto?: string) => parsearTarifasMatriz(csv(t), { desdePorDefecto });

describe('parsearTarifasMatriz', () => {
  it('lee un CSV sintético con coma decimal, miles y fechas dd/mm/aaaa', () => {
    const r = leer('caseta;clase;importe;desde;hasta\nCaseta Ejemplo Norte;5;300,00;01/01/2026;30/06/2026\nCaseta Ejemplo Norte;9;"1,437.50";2026-01-01;\nCaseta Ejemplo Sur;3;$189.00;2026-03-01;\n');
    expect(r.error).toBeUndefined();
    expect(r.rechazadas).toEqual([]);
    expect(r.tarifas.map((t) => [t.casetaNorm, t.clase, t.importe, t.vigenteDesde, t.vigenteHasta])).toEqual([
      ['caseta ejemplo norte', 5, 300, '2026-01-01', '2026-06-30'],
      ['caseta ejemplo norte', 9, 1437.5, '2026-01-01', null],
      ['caseta ejemplo sur', 3, 189, '2026-03-01', null],
    ]);
  });

  it('las vigencias que se traslapan se rechazan con motivo y fila, y la primera se conserva', () => {
    const r = leer('caseta;clase;importe;desde;hasta\nCaseta Ejemplo Norte;5;300;2026-01-01;2026-06-30\nCaseta Ejemplo Norte;5;320;2026-06-30;2026-12-31\nCaseta Ejemplo Norte;5;330;2026-07-01;\n');
    expect(r.tarifas.map((t) => t.fila)).toEqual([2, 4]);
    expect(r.rechazadas).toHaveLength(1);
    expect(r.rechazadas[0].fila).toBe(3);
    expect(r.rechazadas[0].motivo).toMatch(/se traslapa con la de la fila 2/);
  });

  it('una vigencia abierta (sin fin) traslapa con cualquier posterior de la misma caseta y clase, pero no con otra clase', () => {
    const r = leer('caseta;clase;importe;desde;hasta\nCaseta Ejemplo Norte;5;300;2026-01-01;\nCaseta Ejemplo Norte;5;350;2027-01-01;\nCaseta Ejemplo Norte;9;400;2027-01-01;\n');
    expect(r.tarifas.map((t) => t.fila)).toEqual([2, 4]);
    expect(r.rechazadas.map((x) => x.fila)).toEqual([3]);
  });

  it('un importe negativo se rechaza con motivo llano; el cero es válido', () => {
    const r = leer('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;-10;2026-01-01\nCaseta Ejemplo Sur;5;0;2026-01-01\n');
    expect(r.rechazadas).toEqual([{ fila: 2, motivo: 'el importe no puede ser negativo' }]);
    expect(r.tarifas.map((t) => t.importe)).toEqual([0]);
  });

  it('rechaza importe ilegible, clase inválida, fecha ilegible, fin antes del inicio y nombre vacío', () => {
    const r = leer('caseta;clase;importe;desde;hasta\nA Norte;5;mucho;2026-01-01;\nB Norte;0;100;2026-01-01;\nC Norte;5;100;ayer;\nD Norte;5;100;2026-05-01;2026-04-01\n;5;100;2026-01-01;\nE Norte;5,5;100;2026-01-01;\n');
    expect(r.tarifas).toEqual([]);
    expect(r.rechazadas.map((x) => x.fila)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.rechazadas[4].motivo).toBe('falta el nombre de la caseta');
    expect(r.rechazadas[3].motivo).toBe('la vigencia termina antes de empezar');
  });

  it('la misma llave repetida en el archivo se rechaza como repetida', () => {
    const r = leer('caseta;clase;importe;desde\nCaseta Ejemplo Norte;5;300;2026-01-01\nCASETA EJEMPLO NORTE;5;310;2026-01-01\n');
    expect(r.tarifas).toHaveLength(1);
    expect(r.rechazadas[0]).toMatchObject({ fila: 3 });
    expect(r.rechazadas[0].motivo).toMatch(/repetida: ya estaba en la fila 2/);
  });

  it('sin columna «desde» exige una fecha por defecto; con ella la usa', () => {
    expect(leer('caseta;clase;importe\nCaseta Ejemplo Norte;5;300\n').error).toMatch(/Falta la columna «desde»/);
    const r = leer('caseta;clase;importe\nCaseta Ejemplo Norte;5;300\n', '2026-10-15');
    expect(r.tarifas[0]).toMatchObject({ vigenteDesde: '2026-10-15', vigenteHasta: null });
  });

  it('faltan columnas obligatorias → error que nombra cuáles', () => {
    expect(leer('caseta;importe\nA;1\n').error).toMatch(/Faltan columnas: clase/);
    expect(parsearTarifasMatriz([]).error).toBe('El archivo está vacío.');
  });

  it('repara el nombre con mojibake antes de normalizar (misma llave que el catálogo)', () => {
    const r = leer('caseta;clase;importe;desde\nBUCERÃ\u008DAS;5;300;2026-01-01\n');
    expect(r.tarifas[0].casetaNorm).toBe('bucerias');
  });
});

describe('vigenciasSeTraslapan / claseDeCelda / validarTarifaEntrada', () => {
  it('extremos incluidos y sin-fin', () => {
    const v = (d: string, h: string | null) => ({ vigenteDesde: d, vigenteHasta: h });
    expect(vigenciasSeTraslapan(v('2026-01-01', '2026-01-31'), v('2026-01-31', null))).toBe(true);
    expect(vigenciasSeTraslapan(v('2026-01-01', '2026-01-30'), v('2026-01-31', null))).toBe(false);
    expect(vigenciasSeTraslapan(v('2026-01-01', null), v('2030-01-01', null))).toBe(true);
  });
  it('clase', () => {
    expect([claseDeCelda('5'), claseDeCelda(9), claseDeCelda('5.0'), claseDeCelda('5.5'), claseDeCelda('x'), claseDeCelda(100), claseDeCelda('')]).toEqual([5, 9, 5, null, null, null, null]);
  });
  it('un importe astronómico se rechaza', () => {
    expect(validarTarifaEntrada({ caseta: 'A', clase: 5, importe: 5_000_000, vigenteDesde: '2026-01-01', vigenteHasta: null })).toMatch(/pasa de/);
  });
});

describe('planificarTarifa: la regla de confirmación', () => {
  const entrada: TarifaEntrada = { caseta: 'Caseta Ejemplo Norte', clase: 5, importe: 300, vigenteDesde: '2026-01-01', vigenteHasta: null };
  const guardada = (o: Partial<TarifaExistente> = {}): TarifaExistente => ({
    id: 'id-1', casetaNorm: 'caseta ejemplo norte', clase: 5, importe: 300, vigenteDesde: '2026-01-01', vigenteHasta: null,
    origen: 'declarada', confirmada: false, confirmadaPor: null, ...o,
  });

  it('una tarifa declarada o inferida nace SIN confirmar; solo la carga «proveedor» nace confirmada', () => {
    for (const origen of ['declarada', 'inferida'] as const) {
      const p = planificarTarifa([], entrada, origen);
      expect(p).toMatchObject({ tipo: 'crear', fila: { confirmada: false, confirmadaPor: null, origen } });
    }
    expect(planificarTarifa([], entrada, 'proveedor')).toMatchObject({ tipo: 'crear', fila: { confirmada: true, origen: 'proveedor' } });
  });

  it('la misma llave actualiza (no duplica) y conserva el id', () => {
    const p = planificarTarifa([guardada()], { ...entrada, importe: 310 }, 'declarada');
    expect(p).toMatchObject({ tipo: 'actualizar', fila: { id: 'id-1', importe: 310, confirmada: false } });
  });

  it('cambiar el importe de una tarifa confirmada por una persona le quita la confirmación', () => {
    const p = planificarTarifa([guardada({ confirmada: true, confirmadaPor: 'Finanzas' })], { ...entrada, importe: 310 }, 'declarada');
    expect(p).toMatchObject({ tipo: 'actualizar', fila: { importe: 310, confirmada: false, confirmadaPor: null } });
  });

  it('volver a subir el mismo importe NO destruye la confirmación humana (y puede cerrar la vigencia)', () => {
    const conf = guardada({ confirmada: true, confirmadaPor: 'Finanzas' });
    expect(planificarTarifa([conf], entrada, 'inferida')).toMatchObject({ tipo: 'igual', fila: { confirmada: true, confirmadaPor: 'Finanzas', origen: 'declarada' } });
    expect(planificarTarifa([conf], { ...entrada, vigenteHasta: '2026-12-31' }, 'inferida'))
      .toMatchObject({ tipo: 'actualizar', fila: { confirmada: true, confirmadaPor: 'Finanzas', vigenteHasta: '2026-12-31' } });
  });

  it('una vigencia distinta que se traslapa se rechaza; una contigua no', () => {
    const previa = guardada({ vigenteHasta: '2026-06-30' });
    expect(planificarTarifa([previa], { ...entrada, vigenteDesde: '2026-06-30' }, 'declarada')).toMatchObject({ tipo: 'rechazada' });
    expect(planificarTarifa([previa], { ...entrada, vigenteDesde: '2026-07-01' }, 'declarada')).toMatchObject({ tipo: 'crear' });
  });

  it('el mismo rango en otra clase o en otra caseta no choca', () => {
    expect(planificarTarifa([guardada()], { ...entrada, clase: 9 }, 'declarada').tipo).toBe('crear');
    expect(planificarTarifa([guardada()], { ...entrada, caseta: 'Caseta Ejemplo Sur' }, 'declarada').tipo).toBe('crear');
  });

  it('redondea el importe a centavos y rechaza entradas inválidas', () => {
    expect(planificarTarifa([], { ...entrada, importe: 300.005 }, 'declarada')).toMatchObject({ fila: { importe: 300.01 } });
    expect(planificarTarifa([], { ...entrada, importe: -1 }, 'declarada')).toEqual({ tipo: 'rechazada', motivo: 'el importe no puede ser negativo' });
    expect(planificarTarifa([], entrada, 'otra' as never).tipo).toBe('rechazada');
  });
});
