// ═══════════════════════════════════════════════════════════════════════════
// ¿LA FECHA DE ESTE COMPROBANTE ES CREÍBLE?
//
// Vivía suelta dentro del motor. Se saca porque ahora hay DOS sitios que tienen
// que contestar exactamente lo mismo:
//
//   • el motor, al cuadrar, para levantar `fecha_sospechosa`; y
//   • el intake, al recibir la foto, para pedirle otra al operador.
//
// Si cada uno tuviera su propia regla, el modo de falla no sería ruidoso: sería
// pedirle al operador una foto que el cuadre no marca —o peor, no pedírsela y
// después reprocharle la fecha en el PDF—. La misma clase de desacuerdo que ya
// costó un arreglo hoy con `copiasDeComprobante`.
//
// Devuelve el MOTIVO y no un booleano porque los dos consumidores dicen cosas
// distintas: el motor redacta la observación del contralor, el intake redacta lo
// que se le pide al operador.
// ═══════════════════════════════════════════════════════════════════════════

import { hoyMx } from '@/lib/formato';

export type MotivoFechaDudosa =
  /**
   * Ejercicio anterior al corriente. Se detecta CON O SIN rango del viaje.
   *
   * Encontrado con tickets reales: el OCR leyó "2024-07-27" en un ticket que
   * decía "2026 07 27" —dos años de error, confianza 95%— y nada lo marcaba
   * porque la única regla que existía dependía de que el viaje trajera rango.
   *
   * Importa por dinero: un gasto de un ejercicio anterior NO se deduce en éste.
   */
  | 'otro_ejercicio'
  /** Dentro del ejercicio, pero fuera de la ventana del viaje. */
  | 'fuera_de_rango';

export interface VentanaViaje {
  /** Inicio del viaje menos la tolerancia de config. */
  fechaMin?: string | null;
  /** Hoy: un comprobante del futuro no existe. */
  fechaMax?: string | null;
  /** El reloj, inyectado. Ni el motor ni esto lo leen por su cuenta. */
  hoy?: string | null;
}

/**
 * La ventana de un viaje, calculada en UN solo sitio.
 *
 * La usan `cuadrarDesdeDB` (al cerrar) y el intake (al recibir cada foto). Es el
 * mismo motivo por el que la regla de arriba se extrajo: dos ventanas distintas
 * harían que el intake pidiera una foto que el cuadre no marca, o al revés.
 *
 * `hoy` y `fechaMax` son el mismo día a propósito: un comprobante fechado
 * mañana no existe.
 */
export function ventanaDelViaje(
  fechaInicio: string | null | undefined,
  toleranciaDiasAntes: number,
  ahora: Date,
): { fechaMin: string; fechaMax: string; hoy: string } {
  // DAT-28 (auditoría prod): `hoy` era `ahora.toISOString()`, el día UTC. De
  // las 18:00 a las 24:00 hora de México ese "hoy" es ya el de MAÑANA, así
  // que `fechaMax` dejaba pasar como creíble un ticket fechado mañana —
  // exactamente lo que esta ventana existe para rechazar ("un comprobante del
  // futuro no existe")—. El chofer que manda su ticket a las 8 de la noche es
  // el caso NORMAL de este producto, no el raro.
  const hoy = hoyMx(ahora);
  // Sin fecha de inicio la ventana se ancla en HOY (ya en días de México), no
  // en el instante: restarle días a un timestamp y truncarlo en UTC volvía a
  // meter el mismo corrimiento por la puerta de atrás.
  const inicio = new Date(`${(fechaInicio ?? hoy).slice(0, 10)}T00:00:00Z`);
  // Aritmética de calendario sobre un día ya resuelto: no es conversión de
  // zona, y por eso puede ir en UTC sin correr nada.
  const fechaMin = new Date(inicio.getTime() - toleranciaDiasAntes * 86_400_000)
    .toISOString().slice(0, 10);
  return { fechaMin, fechaMax: hoy, hoy };
}

/**
 * `null` = la fecha es creíble, o no hay fecha que juzgar.
 *
 * Sin fecha NO es dudoso: es otro problema (el comprobante entra sin fecha y el
 * motor lo trata aparte). Confundirlos haría que el intake pidiera otra foto de
 * un ticket al que no se le leyó la fecha por estar rota la foto entera, que es
 * justo lo que `pedir_reenvio` ya resuelve mejor.
 */
export function fechaDudosa(
  fecha: string | null | undefined,
  v: VentanaViaje,
): MotivoFechaDudosa | null {
  if (!fecha) return null;
  const f = fecha.slice(0, 10);

  // Se tolera el ejercicio inmediato anterior durante enero: un viaje a caballo
  // entre años es normal en la última semana de diciembre, y marcarlo sería
  // ruido justo cuando más comprobantes hay.
  const ejercicioHoy = v.hoy ? Number(v.hoy.slice(0, 4)) : null;
  const ejercicioGasto = Number(f.slice(0, 4));
  const enero = v.hoy?.slice(5, 7) === '01';
  if (
    ejercicioHoy != null && Number.isFinite(ejercicioGasto) &&
    ejercicioGasto < ejercicioHoy - (enero ? 1 : 0)
  ) return 'otro_ejercicio';

  if ((v.fechaMax != null && f > v.fechaMax) || (v.fechaMin != null && f < v.fechaMin)) {
    return 'fuera_de_rango';
  }
  return null;
}
