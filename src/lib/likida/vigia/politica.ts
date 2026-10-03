// ═══════════════════════════════════════════════════════════════════════════
// LA POLÍTICA DE ENVÍO: ¿sale solo, o lo aprueba el gerente con un toque?
//
// Dos modos por flota (`vigia_config.modo_aprobacion`):
//
//   · `siempre` (el default): TODA respuesta del agente espera al gerente.
//   · `autoenviar_bajo_riesgo`: el agente envía SOLO lo que cumple TODO esto:
//       1. la intención es de las de «dato del viaje» o saludo (no queja, no
//          pide humano, no «otro», no baja);
//       2. el borrador salió de PLANTILLA con datos reales (no de un modelo) y
//          sin faltantes ni tareas humanas, riesgo `bajo`;
//       3. la clasificación es confiable (≥ 0.85) y no trae NINGUNA señal
//          (inyección, folio ajeno, spam…);
//       4. la conversación no está molesta ni escalada ni en manos de un humano;
//       5. el gerente YA validó esa intención: aprobó N respuestas de ella sin
//          editarlas (`autoenviar_min_aprobaciones`). Así el autoenvío se
//          GANA con evidencia, intención por intención, y no se enciende de golpe.
//
// Ante cualquier duda la respuesta es «aprobar»: equivocarse hacia pedir un
// toque cuesta segundos; equivocarse hacia mandar solo puede costar un cliente.
// ═══════════════════════════════════════════════════════════════════════════
import type { Borrador } from './redactor';
import type { Clasificacion, ConfigVigia, Conversacion, Intencion } from './tipos';

/** Las intenciones cuya respuesta puede salir sin aprobación (si todo lo demás cumple). */
export const INTENCIONES_AUTOENVIABLES: readonly Intencion[] = ['ubicacion', 'eta', 'documentos', 'saludo'];

export const CONFIANZA_MINIMA_AUTOENVIO = 0.85;

export type DecisionEnvio =
  | { accion: 'autoenviar'; motivo: string }
  | { accion: 'aprobar'; motivo: string }
  | { accion: 'ninguna'; motivo: string };

export interface EntradaPolitica {
  config: Pick<ConfigVigia, 'habilitado' | 'modoAprobacion' | 'autoenviarMinAprobaciones'>;
  clasificacion: Pick<Clasificacion, 'intencion' | 'confianza' | 'senales'>;
  borrador: Pick<Borrador, 'riesgo' | 'faltantes' | 'tareas' | 'requiereHumano' | 'origen'>;
  conversacion: Pick<Conversacion, 'control' | 'molestiaNivel' | 'escalamientoNivel'>;
  /** Cuántas respuestas de ESTA intención el gerente aprobó sin editar. */
  aprobacionesSinEditar: number;
}

export function decidirEnvio(e: EntradaPolitica): DecisionEnvio {
  if (!e.config.habilitado) return { accion: 'ninguna', motivo: 'agente_apagado' };
  if (e.conversacion.control === 'humano') return { accion: 'ninguna', motivo: 'conversacion_en_manos_de_un_humano' };
  if (e.config.modoAprobacion !== 'autoenviar_bajo_riesgo') return { accion: 'aprobar', motivo: 'modo_siempre_aprobar' };

  if (!INTENCIONES_AUTOENVIABLES.includes(e.clasificacion.intencion)) return { accion: 'aprobar', motivo: 'intencion_no_autoenviable' };
  if (e.clasificacion.senales.length > 0) return { accion: 'aprobar', motivo: 'clasificacion_con_senales' };
  if (e.clasificacion.confianza < CONFIANZA_MINIMA_AUTOENVIO) return { accion: 'aprobar', motivo: 'confianza_baja' };
  if (e.borrador.riesgo !== 'bajo') return { accion: 'aprobar', motivo: 'riesgo_no_bajo' };
  if (e.borrador.requiereHumano) return { accion: 'aprobar', motivo: 'requiere_humano' };
  if (e.borrador.faltantes.length > 0 || e.borrador.tareas.length > 0) return { accion: 'aprobar', motivo: 'faltan_datos_o_hay_tareas' };
  if (e.borrador.origen !== 'plantilla') return { accion: 'aprobar', motivo: 'redaccion_de_modelo' };
  if (e.conversacion.molestiaNivel > 0 || e.conversacion.escalamientoNivel > 0) return { accion: 'aprobar', motivo: 'conversacion_con_molestia' };
  if (e.aprobacionesSinEditar < e.config.autoenviarMinAprobaciones) return { accion: 'aprobar', motivo: 'intencion_aun_no_validada' };
  return { accion: 'autoenviar', motivo: 'bajo_riesgo_validado' };
}
