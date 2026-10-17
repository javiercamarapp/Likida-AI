// ═══════════════════════════════════════════════════════════════════════════
// EJEMPLO DEL CONTRATO DE LIQUIDACIONES (T-A1-40) — el JSON que lleva `docs/integracion/liquidaciones-contrato.md`.
//
// SINTÉTICO: ningún folio, nombre ni cifra es real (el repo es público). La prueba exige que este objeto sea
// idéntico al primer bloque JSON del documento, así el documento que se envía a sistemas es el que la validación acepta.
// ═══════════════════════════════════════════════════════════════════════════

import type { DesgloseBitacora } from './desglose_contrato';

export const CONTRATO_EJEMPLO: DesgloseBitacora = {
  terminal: 'T01',
  bitacora: 'B-0001',
  bitacoras: ['B-0001', 'B-0002'],
  numeroLiquidacion: 'L-0001',
  numeroPago: 'P-0001',
  poliza: 'POL-0001',
  operador: { numeroEmpleado: 'E-0001', nombre: 'Operador Ejemplo Uno' },
  unidad: '0001',
  tipoOperador: 'foraneo',
  desde: '2026-10-09',
  hasta: '2026-10-14',
  dias: 6,
  percepciones: [
    { concepto: 'Sueldo', monto: 4000 },
    { concepto: 'Viáticos', monto: 1500.5 },
  ],
  deducciones: [
    { concepto: 'Retención uno', monto: 300.25 },
    { concepto: 'Anticipo Ciudad Ejemplo', monto: 1000, vale: '100001' },
  ],
  neto: 4200.25,
  enviadoOrigen: false,
};
