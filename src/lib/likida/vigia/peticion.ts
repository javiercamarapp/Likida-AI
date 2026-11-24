// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DE SOLICITUD Y «¿ESTO ES UNA PETICIÓN?» — etiquetas de lectura, sin base ni modelo.
//
// Medido sobre 5 grupos reales de transporte (≈33,000 mensajes, 12-ago a 23-nov-2026): el 84-92 % de los mensajes del cliente
// que piden algo NO lo reconoce ninguna regla de `intencion.ts`, porque los grupos escriben telegráfico («me ayudan con los datos
// de las cajitas», “cp de cruce”, «hora de salida», «me urge»). Las intenciones guardadas (`INTENCIONES`) tienen un CHECK en la
// base, así que aquí NO se agregan intenciones: se agregan ETIQUETAS de solicitud que solo sirven para ordenar y para saber si
// un hilo pide algo. No contestan nada, no cambian umbrales y no se guardan.
//
// GUARDIA: una etiqueta no autoriza a prometer nada. En particular `cp_cruce`, `pod_doda` y `hora_salida` describen cosas que la
// flota emite o decide (carta porte, POD/DODA, horarios): el agente solo AVISA; ver `limites_agente.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from './entrada';

export const TIPOS_SOLICITUD = [
  'ficha_unidad', 'urgencia', 'cp_cruce', 'hora_salida', 'caja_colocacion', 'qr', 'programa', 'estatus', 'sello_gps', 'pod_doda',
] as const;
export type TipoSolicitud = (typeof TIPOS_SOLICITUD)[number];

// Sobre texto normalizado (sin acentos ni signos). Cuantificadores acotados: sin retroceso exponencial.
const REGLAS: ReadonlyArray<[TipoSolicitud, RegExp]> = [
  ['ficha_unidad', /\b(datos?|informacion)\b.{0,30}\b(unidad|unidades|operador|operadores|chofer|choferes|conductor|conductores|cajas?|cajitas?|camion|tracto|remolques?|termos?|thermos?)\b|\b(unidad|unidades|operador|caja)\b.{0,12}\bdatos\b|\b(tenemos|faltan?|falta) (los )?datos\b|\blos datos\b/],
  ['urgencia', /\b(urge|urgen|urgente|urgentes|urgencia|asap)\b/],
  ['cp_cruce', /\b(ccp|cp|cps|carta porte|cartaporte|carta de porte|timbrad[oa]s?|timbrar|timbre)\b/],
  ['hora_salida', /\b(hora|hr|hrs|horas|horario|horarios)\b.{0,12}\b(salida|sale|salen|llegada|llega|llegan|cruce|cita)\b|\ba que hora\b|\bsalida\b|\bhorarios\b/],
  ['caja_colocacion', /\b(cajas?|cajitas?|remolques?|termos?|thermos?)\b.{0,15}\b(vacias?|colocar|colocan|coloquen|colocacion|drop|dejar|disponibles?)\b|\b(colocar|colocan|coloquen|colocacion|colocamos|dropear|drop)\b|\bvacias?\b/],
  ['qr', /\bqr\b/],
  ['programa', /\b(programa|programacion|programas|programadas?|forecast|manana)\b/],
  ['estatus', /\b(como vamos|como van|como va|como andamos|estatus|status|actualizacion|actualizado|actualizar|avance|ya llego|ya salio|ya cruzo|ya viene|en que parte|cruce|cruces|cruzar|cruza|cruzan|cruzo|transfer|entry|aduana)\b/],
  ['sello_gps', /\b(sello|sellos|candado|candados|precinto|gps|samsara|cuenta espejo|espejo|rastreo)\b/],
  ['pod_doda', /\b(pod|doda|remision|remisiones|acuse)\b/],
];

/** Etiquetas de solicitud que el texto contiene (puede ser ninguna). Nunca lanza. */
export function tiposDeSolicitud(texto: string): TipoSolicitud[] {
  const n = normalizar(texto ?? '');
  if (!n) return [];
  return REGLAS.filter(([, r]) => r.test(n)).map(([t]) => t);
}

// Marcas de que el mensaje PIDE algo aunque no traiga signo de interrogación: «me ayudan con…», «confirmen…», «favor de…».
const MARCA_PETICION = /\b(favor|porfa|pls|plis|please|apoy\w{0,8}|ayud\w{0,8}|confirm\w{0,8}|necesit\w{0,8}|ocup\w{0,6}|requer\w{0,8}|tenemos|tienen|saben|cuando|cuanto|donde|a que hora|que (hora|caja|unidad))\b/;

// Solicitudes que, por sí solas, ya son una petición.
const TIPOS_QUE_PIDEN: ReadonlySet<TipoSolicitud> = new Set<TipoSolicitud>(['ficha_unidad', 'urgencia', 'cp_cruce', 'hora_salida', 'qr', 'estatus']);

/**
 * ¿El mensaje del cliente pide algo? Signo de interrogación, marca de ruego o una solicitud reconocible. Un reenvío de lista, una
 * foto o un «gracias» no lo son. Se usa para no tratar como «sin atender» lo que solo es información que el cliente comparte.
 */
export function esPeticion(texto: string): boolean {
  if (/[?¿]/.test(texto ?? '')) return true;
  const n = normalizar(texto ?? '');
  if (!n) return false;
  if (MARCA_PETICION.test(n)) return true;
  return tiposDeSolicitud(texto).some((t) => TIPOS_QUE_PIDEN.has(t));
}
