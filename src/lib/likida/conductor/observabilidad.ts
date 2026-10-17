// ═══════════════════════════════════════════════════════════════════════════
// OBSERVABILIDAD MÍNIMA DEL CONDUCTOR EN PRODUCCIÓN (T-A5-27).
//
// El latido del cron `conductor-hitos` ya dice si la pasada corrió; esto añade CONTADORES para saber si el
// piloto está VIVO: cuántos viajes se siguen y por qué origen entraron, cuántos avisos salieron, cuántos
// rechazó Meta, qué hitos detectó el GPS y por qué vía, cuántos viajes no se pueden seguir por falta de sitio
// o de GPS, y cuántos voluntarios hay activos.
//
// Solo números y códigos: ningún teléfono, nombre, folio ni coordenada (R-13). Dos alarmas:
//   · `sin_viajes_con_voluntarios`: hay voluntarios activos y ningún viaje en seguimiento.
//   · `flota_sin_posicion`: más de la mitad de las unidades en tránsito sin posición en 45 min.
// ═══════════════════════════════════════════════════════════════════════════

import type { ResultadoConductor } from './ejecutor';
import type { ResultadoCicloGps } from './ciclo_gps';
import type { ResultadoSenalVida } from './senal_vida';

/** Minutos sin posición a partir de los cuales una unidad en tránsito cuenta como «sin posición». */
export const MINUTOS_SIN_POSICION = 45;
/** Fracción por encima de la cual la flota en tránsito se considera ciega. */
export const FRACCION_ALARMA_SIN_POSICION = 0.5;

export type CodigoAlarmaConductor = 'sin_viajes_con_voluntarios' | 'flota_sin_posicion';

export interface ContadoresConductor {
  viajesEnSeguimiento: number;
  viajesPorOrigen: { chofer: number; importacion: number; otro: number };
  avisosEnviados: number;
  rechazosMeta: number;
  hitosPorGps: number;
  hitosViaDespacho: number;
  hitosViaUnidadVentana: number;
  viajesSinSitio: number;
  viajesSinGps: number;
  voluntariosActivos: number | null;
  unidadesEnTransito: number;
  unidadesSinPosicion: number;
}

type Motor = Pick<ResultadoConductor, 'viajes' | 'solicitudes' | 'recordatorios' | 'escalaciones' | 'rechazosReintentables' | 'viajesPorOrigen'>;
type Gps = Pick<ResultadoCicloGps, 'detectados' | 'sinSitio' | 'sinMuestras'> & Partial<Pick<ResultadoCicloGps, 'detectadosViaDespacho' | 'detectadosViaUnidadVentana' | 'unidadesConsultadas' | 'unidadesSinPosicion'>>;
type Senal = Pick<ResultadoSenalVida, 'avisosChofer' | 'escalaciones' | 'rechazosReintentables'>;

export interface EntradaObservabilidad {
  motor: Motor;
  gps?: Gps;
  senalVida?: Senal;
  /** `null` = no se pudo contar (base sin la 0800 o sin respuesta): no se alarma con un dato que no se tiene. */
  voluntariosActivos: number | null;
}

const n = (x: number | undefined | null): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

export function contadoresConductor(e: EntradaObservabilidad): ContadoresConductor {
  const o = e.motor.viajesPorOrigen ?? { chofer: 0, importacion: 0, otro: 0 };
  return {
    viajesEnSeguimiento: n(e.motor.viajes),
    viajesPorOrigen: { chofer: n(o.chofer), importacion: n(o.importacion), otro: n(o.otro) },
    avisosEnviados: n(e.motor.solicitudes) + n(e.motor.recordatorios) + n(e.motor.escalaciones) + n(e.senalVida?.avisosChofer) + n(e.senalVida?.escalaciones),
    rechazosMeta: n(e.motor.rechazosReintentables) + n(e.senalVida?.rechazosReintentables),
    hitosPorGps: n(e.gps?.detectados),
    hitosViaDespacho: n(e.gps?.detectadosViaDespacho),
    hitosViaUnidadVentana: n(e.gps?.detectadosViaUnidadVentana),
    viajesSinSitio: n(e.gps?.sinSitio),
    viajesSinGps: n(e.gps?.sinMuestras),
    voluntariosActivos: e.voluntariosActivos,
    unidadesEnTransito: n(e.gps?.unidadesConsultadas),
    unidadesSinPosicion: n(e.gps?.unidadesSinPosicion),
  };
}

export function alarmasConductor(c: ContadoresConductor): CodigoAlarmaConductor[] {
  const a: CodigoAlarmaConductor[] = [];
  if (c.voluntariosActivos !== null && c.voluntariosActivos > 0 && c.viajesEnSeguimiento === 0) a.push('sin_viajes_con_voluntarios');
  if (c.unidadesEnTransito > 0 && c.unidadesSinPosicion / c.unidadesEnTransito > FRACCION_ALARMA_SIN_POSICION) a.push('flota_sin_posicion');
  return a;
}
