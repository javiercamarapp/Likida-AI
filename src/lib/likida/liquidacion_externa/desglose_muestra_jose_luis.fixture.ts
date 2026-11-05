// Muestra SINTÉTICA en la forma real de 'muestra-jose-luis' (5-nov-2026). Valores claramente ficticios: este repo es público.

import type { PadronOperadores } from './desglose_muestra_jose_luis';

export const BITACORA_MUESTRA = {
  BitacoraID: 900001,
  Operador: 'Operador Ficticio Uno',
  Unidad: '0526',
  Fecha: { Inicia: '2026-10-09 06:00:00', Termina: '2026-10-14 20:00:00' },
  Percepciones: [
    { Descripcion: 'Sueldo semanal', Monto: 4000.0 },
    { Descripcion: 'Bono de puntualidad', Monto: 500.5 },
    { Descripcion: 'Estadía cliente', Monto: 300 },
    { Descripcion: 'Recolección', Monto: 150.25 },
  ],
  Deducciones: [
    { Descripcion: 'Fonacot', Monto: 200.1 },
    { Descripcion: 'Infonavit', Monto: 350 },
    { Descripcion: 'Anticipo de viaje', Monto: 1000 },
    { Descripcion: 'Diésel excedente', Monto: 99.9 },
  ],
  CampoExtraDesconocido: { x: 1 },
} as const;

/** Neto esperado en centavos: 495075 − 165000 = 330075. */
export const NETO_MUESTRA_CENTAVOS = 495_075 - 165_000;

export const PADRON_MUESTRA: PadronOperadores = [
  { numeroEmpleado: '1001', nombre: 'Operador Ficticio Uno' },
  { numeroEmpleado: '1002', nombre: 'Operador Ficticio Dos' },
  { numeroEmpleado: '1003', nombre: 'Homónimo Ficticio' },
  { numeroEmpleado: '1004', nombre: 'HOMONIMO  ficticio' },
];
