import { describe, expect, it } from 'vitest';
import { gastoApiladoPorFlota, PROPOSITOS } from './apilado';

const f = (tenantId: string, proposito: 'interactivo' | 'ocr_lote' | 'fondo', liquidadoUsd: number) =>
  ({ tenantId, tenantNombre: `Flota ${tenantId}`, proposito, liquidadoUsd, reservadoVivoUsd: 99, n: 1 });

describe('gastoApiladoPorFlota', () => {
  it('una columna por flota, mayor gasto primero, solo lo liquidado y un propósito sin fila queda null', () => {
    const { series, periodos } = gastoApiladoPorFlota([f('a', 'interactivo', 1), f('b', 'fondo', 5), f('b', 'interactivo', 2), f('a', 'fondo', 0.5)]);
    expect(series).toEqual(PROPOSITOS);
    expect(periodos.map((p) => p.etiqueta)).toEqual(['Flota b', 'Flota a']);
    expect(periodos[0].partes).toEqual([2, null, 5]);
    expect(periodos[1].partes).toEqual([1, null, 0.5]);
  });
  it('sin filas no hay columnas', () => {
    expect(gastoApiladoPorFlota([]).periodos).toEqual([]);
  });
});
