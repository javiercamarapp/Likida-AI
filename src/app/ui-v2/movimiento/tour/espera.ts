import type { LecturaSenal } from './tipos';

// Reglas puras de los pasos «hacer»/«practicar» (SPEC-ONBOARDING-GUIA 2.3): línea base, ya hecho, sondeo y tiempo límite. Sin DOM ni reloj:
// el controlador las aplica y el anfitrión programa los temporizadores. Nunca hay un intervalo perpetuo: el sondeo existe solo
// mientras el paso espera.

export const TIEMPO_LIMITE_POR_OMISION_MS = 90_000;
export const AVANCE_TRAS_HECHO_MS = 600;
/** 3, 6 y 10 segundos y luego cada 15. */
export const RETARDOS_SONDEO_MS: readonly number[] = [3000, 6000, 10_000];
export const RETARDO_SONDEO_FINAL_MS = 15_000;

export const retardoDeSondeo = (intento: number): number => RETARDOS_SONDEO_MS[intento] ?? RETARDO_SONDEO_FINAL_MS;

export type ResolucionBase = 'ya_hecho' | 'esperando' | 'sin_dato';
export type ResolucionSondeo = 'hecho' | 'esperando';

/** Primera lectura al activarse el paso: si la señal ya es verdadera no se hace esperar a nadie. */
export function resolverBase(base: LecturaSenal): ResolucionBase {
  if (base.estado === 'sin_dato') return 'sin_dato';
  return base.estado === 'si' ? 'ya_hecho' : 'esperando';
}

/** Lecturas siguientes. Una lectura `sin_dato` es un bache: se sigue esperando (el tiempo límite decide). */
export function resolverSondeo(base: LecturaSenal, ahora: LecturaSenal, modo: 'cambia' | 'existe'): ResolucionSondeo {
  if (ahora.estado !== 'si') return 'esperando';
  if (modo === 'existe') return 'hecho';
  // «cambia»: la señal pasó de no a sí, o su conteo subió respecto de la línea base.
  if (base.estado !== 'si') return 'hecho';
  return typeof ahora.n === 'number' && typeof base.n === 'number' && ahora.n > base.n ? 'hecho' : 'esperando';
}
