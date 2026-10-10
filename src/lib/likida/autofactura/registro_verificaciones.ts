import datos from '../facturacion/adaptadores/verificaciones.json';
import type { RegistroVerificaciones } from './verificacion';

/** El registro vigente, leído de `verificaciones.json` (escrito solo por la corrida supervisada). */
export const REGISTRO_VERIFICACIONES: RegistroVerificaciones =
  (datos as { verificaciones: RegistroVerificaciones }).verificaciones;
