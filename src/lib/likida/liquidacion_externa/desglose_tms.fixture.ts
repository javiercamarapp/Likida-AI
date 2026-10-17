// Respuestas SINTÉTICAS del TMS en tres formas posibles (T-A1-25). Cero datos reales: este repo es público.
// Las tres describen la MISMA bitácora y deben dar el mismo `DesgloseBitacora`. Forma y nombres de campo: SUPUESTO-API.

import type { DesgloseBitacora } from './desglose_contrato';
import type { MapeoTms } from './desglose_mapeo_tms';

const cabecera = {
  bitacora: 'B-0001', poliza: 'P-0001', terminal: 'T01', operador: '1001', nombreOperador: 'Operador Ejemplo Uno',
  unidad: '0526', tipo: 'foraneo', inicio: '2026-10-09T06:00:00', fin: '2026-10-14T20:00:00', dias: 6, neto: 4150, enviado: 0,
};

/** Forma A: nodos separados `percepciones[]` / `deducciones[]`; los viáticos traen su detalle anidado. */
export const TMS_NODOS = {
  cabecera,
  percepciones: [
    { desglose: 'Sueldo', descripcion: 'SUELDO SEMANAL', monto: '4000.00' },
    { desglose: 'Viáticos', descripcion: 'VIATICOS', tipo: 'V', monto: 1500.5, detalle: [
      { descripcion: 'Taxi', monto: 300 }, { descripcion: 'Talacha', monto: 300 }, { descripcion: 'Lavada', monto: 900.5 },
    ] },
    { desglose: 'KM. Extra', descripcion: 'KM EXTRA', monto: 4050 },
    { desglose: '', descripcion: 'Demora cliente', monto: 0 },
  ],
  deducciones: [
    { desglose: 'Anticipo Ciudad Ejemplo', descripcion: 'ANTICIPO', vale: '*100001', monto: 1000 },
    { desglose: 'Descuento financiero', descripcion: 'DESC FIN', monto: 4400.5 },
  ],
};

/** Forma B: lista plana con cargo/abono; el renglón sin valor se ignora y el viático es un renglón tipo V con su descripción. */
export const TMS_PLANA = {
  cabecera,
  renglones: [
    { desglose: 'Sueldo', descripcion: 'SUELDO SEMANAL', tipo: 'S', cargo: 4000, abono: 0 },
    { desglose: 'Viáticos', descripcion: 'Taxi', tipo: 'V', cargo: 300, abono: 0 },
    { desglose: 'Viáticos', descripcion: 'Talacha', tipo: 'UV', cargo: 300, abono: 0 },
    { desglose: 'Viáticos', descripcion: 'Lavada', tipo: 'V', cargo: 900.5, abono: 0 },
    { desglose: 'KM. Extra', descripcion: 'KM EXTRA', tipo: 'S', cargo: 4050, abono: 0 },
    { desglose: 'Anticipo Ciudad Ejemplo', descripcion: 'ANTICIPO', tipo: 'S', vale: '100001', cargo: 0, abono: 1000 },
    { desglose: 'Descuento financiero', descripcion: 'DESC FIN', tipo: 'S', cargo: 0, abono: 4400.5 },
    { desglose: 'Sin valor', descripcion: 'VACIO', tipo: 'S', cargo: 0, abono: 0 },
  ],
};

/** Forma C: `desglose` vacío o ausente en todos los renglones ⇒ el concepto cae a la descripción. */
export const TMS_SIN_DESGLOSE = {
  cabecera,
  percepciones: [
    { desglose: '', descripcion: 'Sueldo', monto: 4000 },
    { desglose: null, descripcion: 'Taxi', tipo: 'V', monto: 300 },
    { descripcion: 'Talacha', tipo: 'UV', monto: 300 },
    { desglose: '  ', descripcion: 'Lavada', tipo: 'V', monto: 900.5 },
    { descripcion: 'KM. Extra', monto: 4050 },
  ],
  deducciones: [
    { descripcion: 'Anticipo Ciudad Ejemplo', vale: '100001', monto: 1000 },
    { descripcion: 'Descuento financiero', monto: 4400.5 },
  ],
};

const cab = {
  bitacora: 'cabecera.bitacora', poliza: 'cabecera.poliza', terminal: 'cabecera.terminal', operadorNumero: 'cabecera.operador',
  operadorNombre: 'cabecera.nombreOperador', unidad: 'cabecera.unidad', tipoOperador: 'cabecera.tipo', desde: 'cabecera.inicio',
  hasta: 'cabecera.fin', dias: 'cabecera.dias', neto: 'cabecera.neto', enviado: 'cabecera.enviado',
};

export const MAPEO_NODOS: MapeoTms = {
  ...cab, percepciones: 'percepciones', deducciones: 'deducciones',
  renglon: { desglose: 'desglose', descripcion: 'descripcion', vale: 'vale', monto: 'monto', tipoConcepto: 'tipo', detalleViaticos: 'detalle' },
};
export const MAPEO_PLANA: MapeoTms = {
  ...cab, renglones: 'renglones',
  renglon: { desglose: 'desglose', descripcion: 'descripcion', vale: 'vale', cargo: 'cargo', abono: 'abono', tipoConcepto: 'tipo' },
};
export const MAPEO_SIN_DESGLOSE: MapeoTms = {
  ...cab, percepciones: 'percepciones', deducciones: 'deducciones',
  renglon: { desglose: 'desglose', descripcion: 'descripcion', vale: 'vale', monto: 'monto', tipoConcepto: 'tipo' },
};

/** Lo que las tres formas deben producir. */
export const DESGLOSE_TMS_ESPERADO_CAB = {
  terminal: 'T01', bitacora: 'B-0001', poliza: 'P-0001', operador: { numeroEmpleado: '1001', nombre: 'Operador Ejemplo Uno' },
  unidad: '526', tipoOperador: 'foraneo', desde: '2026-10-09', hasta: '2026-10-14', dias: 6, neto: 4150, enviadoOrigen: false,
} as const satisfies Partial<DesgloseBitacora>;
