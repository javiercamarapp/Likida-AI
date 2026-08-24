import { describe, expect, it } from 'vitest';
import { interpretarPerfilExportacion } from './perfiles';

const CONFIRMADO = '2026-08-24T10:00:00.000Z';

describe('perfil ERP por tenant', () => {
  it('CONTPAQi exige tipo, número, separador y un encabezado completo confirmados', () => {
    const r = interpretarPerfilExportacion('contpaqi', {
      tipo: 'Dr', numeroInicial: 42, separador: '|',
      encabezado: ['Tipo', 'Numero', 'Fecha', 'Concepto', 'Cuenta', 'TipoMovimiento', 'Importe', 'Referencia', 'ConceptoMovimiento'],
    }, CONFIRMADO);
    expect(r).toMatchObject({ sistema: 'contpaqi', opciones: { tipo: 'Dr', numero: 42, separador: '|' } });
  });

  it('no acepta un perfil sin confirmación ni un encabezado inventado', () => {
    expect(interpretarPerfilExportacion('contpaqi', { tipo: 'Dr', separador: ',' }, null)).toBeNull();
    expect(interpretarPerfilExportacion('contpaqi', { tipo: 'Dr', separador: ',' }, CONFIRMADO)).toBeNull();
    expect(interpretarPerfilExportacion('contpaqi', { tipo: 'Dr', separador: ',', encabezado: ['solo', 'dos'] }, CONFIRMADO)).toBeNull();
  });

  it('SAP B1 exige las cuatro filas de plantilla con igual número de columnas', () => {
    const r = interpretarPerfilExportacion('sap_b1', {
      cabeceraTecnica: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
      cabeceraVisible: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
      lineasTecnica: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
      lineasVisible: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
    }, CONFIRMADO);
    expect(r?.sistema).toBe('sap_b1');
    expect(interpretarPerfilExportacion('sap_b1', {}, CONFIRMADO)).toBeNull();
  });
});
