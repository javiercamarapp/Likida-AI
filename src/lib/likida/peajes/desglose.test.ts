import { describe, it, expect } from 'vitest';
import { interpretarDesglose } from './desglose';

describe('interpretarDesglose — el archivo del proveedor de peaje', () => {
  it('lee un desglose típico (encabezados con acentos y importes con $)', () => {
    const r = interpretarDesglose([
      ['Fecha de cruce', 'Plaza de cobro', 'No. TAG', 'Importe'],
      ['05/08/2026', 'TEPOTZOTLÁN', 'IMDM123', '$385.00'],
      ['06/08/2026', 'PALMILLAS', 'IMDM123', '512'],
    ]);
    expect(r.error).toBeUndefined();
    expect(r.lineas).toEqual([
      { fecha: '2026-08-05', caseta: 'TEPOTZOTLÁN', monto: 385, tag: 'IMDM123', fila: 2 },
      { fecha: '2026-08-06', caseta: 'PALMILLAS', monto: 512, tag: 'IMDM123', fila: 3 },
    ]);
  });

  it('sin columna de importe se pide el archivo, no se adivina el dinero', () => {
    const r = interpretarDesglose([['Fecha', 'Caseta'], ['01/08/2026', 'X']]);
    expect(r.error).toContain('columna del importe');
  });

  it('las filas rotas se descartan con motivo y fila — el total de la lectura no miente', () => {
    const r = interpretarDesglose([
      ['fecha', 'caseta', 'importe'],
      ['01/08/2026', 'TEPOTZOTLÁN', ''],
      ['01/08/2026', '', '100'],
      ['99/99/2026', 'PALMILLAS', '100'],
      ['02/08/2026', 'PALMILLAS', '100'],
    ]);
    expect(r.lineas).toHaveLength(1);
    expect(r.descartadas).toEqual([
      { fila: 2, motivo: 'sin importe' },
      { fila: 3, motivo: 'sin caseta' },
      { fila: 4, motivo: 'fecha ilegible' },
    ]);
  });

  it('la fecha puede faltar (el archivo no la trae) sin tirar la línea', () => {
    const r = interpretarDesglose([['caseta', 'importe'], ['TEPOTZOTLÁN', '385']]);
    expect(r.lineas[0].fecha).toBeNull();
    expect(r.lineas[0].monto).toBe(385);
  });
});
