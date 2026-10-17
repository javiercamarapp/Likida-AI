import { describe, it, expect } from 'vitest';
import { inferirTarifas, type LineaTarifaInferible } from './tarifario_inferido';

const rep = (caseta: string, clase: number, monto: number, n: number): LineaTarifaInferible[] =>
  Array.from({ length: n }, () => ({ caseta, clase, monto }));

describe('inferirTarifas', () => {
  it('30 cruces clase 5 a $300 y 3 a $450 → tarifa $300 con 3 anómalos', () => {
    const r = inferirTarifas([...rep('Caseta Ejemplo Norte', 5, 300, 30), ...rep('Caseta Ejemplo Norte', 5, 450, 3)]);
    expect(r.tarifas).toEqual([{
      casetaNorm: 'caseta ejemplo norte', clase: 5, importe: 300, cruces: 33, anomalos: 3, dispersion: 0.091,
      origen: 'inferida', confirmada: false,
    }]);
    expect(r.sinTarifaEstable).toEqual([]);
    expect(r.casetasInestables).toEqual([]);
  });

  it('toda tarifa inferida sale como inferida y sin confirmar', () => {
    const r = inferirTarifas([...rep('A', 5, 100, 25), ...rep('B', 3, 80, 25)]);
    expect(r.tarifas).toHaveLength(2);
    expect(r.tarifas.every((t) => t.origen === 'inferida' && t.confirmada === false)).toBe(true);
  });

  it('caseta con 40 cruces clase 1 a $82 y ninguno de clase 5 → sugiere por_pasada', () => {
    const r = inferirTarifas(rep('Caseta Ejemplo Sur', 1, 82, 40));
    expect(r.porPasada).toEqual([{ casetaNorm: 'caseta ejemplo sur', cruces: 40, motivo: 'una_sola_clase', clase: 1 }]);
    expect(r.tarifas[0]).toMatchObject({ clase: 1, importe: 82 });
  });

  it('una caseta dominada por clase 5 NO se sugiere por_pasada', () => {
    expect(inferirTarifas(rep('A', 5, 300, 40)).porPasada).toEqual([]);
  });

  it('importes casi iguales entre clases → por_pasada por importes similares', () => {
    const r = inferirTarifas([...rep('Caseta Mixta', 1, 100, 25), ...rep('Caseta Mixta', 3, 101, 25), ...rep('Caseta Mixta', 5, 102, 25)]);
    expect(r.porPasada).toEqual([{ casetaNorm: 'caseta mixta', cruces: 75, motivo: 'importes_similares_entre_clases', clase: null }]);
  });

  it('importes distintos entre clases NO es por_pasada', () => {
    const r = inferirTarifas([...rep('Caseta Mixta', 3, 150, 25), ...rep('Caseta Mixta', 5, 300, 25)]);
    expect(r.porPasada).toEqual([]);
  });

  it('caseta con 10 cruces → datos insuficientes, sin tarifa', () => {
    const r = inferirTarifas(rep('Caseta Chica', 5, 300, 10));
    expect(r.tarifas).toEqual([]);
    expect(r.datosInsuficientes).toEqual([{ casetaNorm: 'caseta chica', clase: 5, cruces: 10 }]);
  });

  it('sin moda clara → «sin tarifa estable» con mediana y rango', () => {
    const lineas = [...rep('Caseta Variable', 5, 300, 8), ...rep('Caseta Variable', 5, 350, 8), ...rep('Caseta Variable', 5, 400, 8)];
    const r = inferirTarifas(lineas);
    expect(r.tarifas).toEqual([]);
    expect(r.sinTarifaEstable).toEqual([{
      casetaNorm: 'caseta variable', clase: 5, cruces: 24, mediana: 350, minimo: 300, maximo: 400, fraccionModal: 0.333,
    }]);
  });

  it('moda estable pero con más de 10 % fuera de ella → se lista como caseta inestable', () => {
    const r = inferirTarifas([...rep('Caseta Rara', 5, 300, 24), ...rep('Caseta Rara', 5, 450, 6)]);
    expect(r.tarifas[0]).toMatchObject({ importe: 300, anomalos: 6 });
    expect(r.casetasInestables).toEqual([{ casetaNorm: 'caseta rara', clase: 5, cruces: 30, importeModal: 300, anomalos: 6, dispersion: 0.2 }]);
  });

  it('respeta minCruces y dispersionMax configurables', () => {
    const lineas = rep('A', 5, 300, 10);
    expect(inferirTarifas(lineas, { minCruces: 10 }).tarifas).toHaveLength(1);
    expect(inferirTarifas(lineas).tarifas).toHaveLength(0);
  });

  it('agrupa por caseta física cuando la hay', () => {
    const lineas = [
      ...Array.from({ length: 12 }, () => ({ caseta: 'Plaza Norte Sentido A', casetaFisica: 'Plaza Norte', clase: 5, monto: 300 })),
      ...Array.from({ length: 12 }, () => ({ caseta: 'Plaza Norte Sentido B', casetaFisica: 'Plaza Norte', clase: 5, monto: 300 })),
    ];
    const r = inferirTarifas(lineas);
    expect(r.tarifas).toEqual([expect.objectContaining({ casetaNorm: 'plaza norte', cruces: 24 })]);
  });

  it('es determinista: filas barajadas dan el mismo resultado', () => {
    const base = [...rep('A', 5, 300, 30), ...rep('A', 5, 450, 3), ...rep('B', 1, 82, 40), ...rep('C', 5, 10, 3)];
    const barajadas = [...base].reverse().sort((x, y) => ((x.monto * 7) % 13) - ((y.monto * 7) % 13));
    expect(inferirTarifas(barajadas)).toEqual(inferirTarifas(base));
  });

  it('empate de moda → gana el importe menor, siempre', () => {
    const r = inferirTarifas([...rep('A', 5, 400, 15), ...rep('A', 5, 300, 15)], { modaMinima: 0.5 });
    expect(r.tarifas[0].importe).toBe(300);
  });

  it('ignora líneas sin caseta, sin clase o con monto no positivo', () => {
    const r = inferirTarifas([
      { caseta: null, clase: 5, monto: 100 }, { caseta: 'A', clase: null, monto: 100 }, { caseta: 'A', clase: 5, monto: 0 },
      { caseta: 'A', clase: 5, monto: Number.NaN },
    ]);
    expect(r.ignoradas).toBe(4);
    expect(r.tarifas).toEqual([]);
  });
});
