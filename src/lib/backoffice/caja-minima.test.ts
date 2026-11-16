import { describe, expect, it } from 'vitest';
import { MESES_CAJA_REQUERIDOS, puedeAbrirPuestoFijo, UMBRAL_NETO_MENSUAL_MXN } from './caja-minima';

describe('puedeAbrirPuestoFijo', () => {
  it('constantes del candado', () => {
    expect(UMBRAL_NETO_MENSUAL_MXN).toBe(71_500);
    expect(MESES_CAJA_REQUERIDOS).toBe(6);
  });
  it('hoy, con insumos null: no permitido y dice qué falta (no es cero)', () => {
    const v = puedeAbrirPuestoFijo({ netoMensualMxn: null, cajaMxn: null, costoPuestoMxn: null });
    expect(v.permitido).toBe(false);
    expect(v.falta).toEqual(['neto_mensual', 'costo_puesto', 'caja']);
    expect(v.cajaRequeridaMxn).toBeNull();
  });
  it('un neto de 0 es un dato real y no alcanza, distinto de null', () => {
    expect(puedeAbrirPuestoFijo({ netoMensualMxn: 0, cajaMxn: 1e6, costoPuestoMxn: 10_000 }).falta).toEqual(['neto_insuficiente']);
  });
  it('frontera del neto: 71,499.99 no, 71,500 sí', () => {
    expect(puedeAbrirPuestoFijo({ netoMensualMxn: 71_499.99, cajaMxn: 60_000, costoPuestoMxn: 10_000 }).falta).toEqual(['neto_insuficiente']);
    expect(puedeAbrirPuestoFijo({ netoMensualMxn: 71_500, cajaMxn: 60_000, costoPuestoMxn: 10_000 }).permitido).toBe(true);
  });
  it('frontera de la caja: 6 meses del costo exactos sí, un peso menos no', () => {
    expect(puedeAbrirPuestoFijo({ netoMensualMxn: 80_000, cajaMxn: 59_999, costoPuestoMxn: 10_000 })).toMatchObject({ permitido: false, falta: ['caja_insuficiente'], cajaRequeridaMxn: 60_000 });
    expect(puedeAbrirPuestoFijo({ netoMensualMxn: 80_000, cajaMxn: 60_000, costoPuestoMxn: 10_000 }).permitido).toBe(true);
  });
  it('sin costo del puesto no se puede saber la caja requerida', () => {
    const v = puedeAbrirPuestoFijo({ netoMensualMxn: 80_000, cajaMxn: 500_000, costoPuestoMxn: null });
    expect(v.permitido).toBe(false);
    expect(v.falta).toEqual(['costo_puesto']);
  });
  it('valores negativos o no finitos cuentan como sin dato', () => {
    expect(puedeAbrirPuestoFijo({ netoMensualMxn: -1, cajaMxn: Number.NaN, costoPuestoMxn: 1 }).falta).toEqual(['neto_mensual', 'caja']);
  });
});
