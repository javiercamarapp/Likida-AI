// ═══════════════════════════════════════════════════════════════════════════
// EL MARGEN «LEJOS DE LA CASETA» POR FLOTA (T-A2-24). PURO.
//
// `gps_lejos_de_caseta` afirma que la unidad NO estaba en la caseta solo si su trayectoria queda a más de
// «radio + margen» de ella (`cruce_gps.ts`). El margen era una constante (1000 m). El cliente habló de
// 200 o 500 m sin decidir (la distancia entre la posición y la caseta); mientras no decida, el valor de
// siempre es el de omisión y cada flota puede fijar el suyo. Lo que llega de la pantalla se VALIDA y se
// rechaza con un mensaje llano (no se «arregla»); lo guardado y corrupto cae al de siempre (nunca afirma de más).
// ═══════════════════════════════════════════════════════════════════════════

/** El margen de siempre (m). Vive aquí para que `cruce_gps.ts` y la configuración lo compartan sin ciclos. */
export const MARGEN_LEJOS_DEFAULT_M = 1000;
export const MARGEN_LEJOS_MIN_M = 100;
export const MARGEN_LEJOS_MAX_M = 5000;

const MENSAJE = `El margen de distancia debe ser un número entero de metros entre ${MARGEN_LEJOS_MIN_M} y ${MARGEN_LEJOS_MAX_M}.`;

export type ValidadoMargen = { ok: true; valor: number } | { ok: false; motivo: string };

/** `true` si es un margen usable (entero finito dentro de rango). */
export function margenLejosValido(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= MARGEN_LEJOS_MIN_M && x <= MARGEN_LEJOS_MAX_M;
}

export function validarMargenLejos(entrada: unknown): ValidadoMargen {
  return margenLejosValido(entrada) ? { ok: true, valor: entrada } : { ok: false, motivo: MENSAJE };
}

/** El margen que usa la flota: el guardado y válido, o el de siempre. */
export function margenLejosEfectivo(guardado: unknown): number {
  return margenLejosValido(guardado) ? guardado : MARGEN_LEJOS_DEFAULT_M;
}
