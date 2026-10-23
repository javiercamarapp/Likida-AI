import { logger } from '@/lib/logger';
import type { ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import type { ConfigConductor } from './config';
import type { MensajeSaliente } from './solicitudes';

// ═══════════════════════════════════════════════════════════════════════════
// LA COMPUERTA DE DATOS DEL AGENTE 5 (0859) — fail-closed.
//
// El Agente 5 NO le escribe a ningún chofer de una flota que no lo tenga habilitado de forma EXPLÍCITA
// (`agente_conductor_config.agente_chofer_habilitado = true`, que nace en false). Dos capas:
//
//   1. LECTURA DE LA CONFIG: sin la marca, la flota se lee como `activo = false` → ningún motor (solicitudes, recordatorios, escalera,
//      señal de vida, estadía, reporte, detención) toma sus viajes. No se reclama nada ni se consume un recordatorio: al habilitarla
//      la escalera arranca de cero, en vez de haber «avisado» a un chofer al que nunca se le escribió.
//   2. EL PUERTO DE ENVÍO: antes de CADA mensaje proactivo al chofer se consulta la función de la base. Cualquier duda (función
//      ausente por migración sin aplicar, base caída, valor distinto de true) = NO se envía, y queda dicho en el registro.
//
// A diferencia de otras lecturas tolerantes del módulo (columna ausente = valor de partida), aquí el valor de partida de una columna
// ausente es «apagado»: el seguro es no enviar.
// ═══════════════════════════════════════════════════════════════════════════

/** Contextos de `enviar` que van AL CHOFER. Los demás (escalaciones, avisos al supervisor o a la oficina) tienen otro destinatario. */
const PREFIJOS_AL_CHOFER = [
  'conductor.solicitud', 'conductor.recordatorio', 'conductor.pregunta_estadia', 'conductor.senal_vida_n',
  'conductor.deteccion_parada', 'conductor.reporte_llegada', 'conductor.asignacion_instrucciones', 'conductor.gastos_etc_pregunta',
] as const;

/** ¿Este contexto de envío le escribe al chofer? (`conductor.senal_vida_n1`, `conductor.solicitud`, …). */
export function esEnvioAlChofer(contexto: string): boolean {
  return PREFIJOS_AL_CHOFER.some((p) => contexto === p || (p.endsWith('_n') && contexto.startsWith(p)));
}

/**
 * La config tal como la ve el motor: sin la marca explícita la flota queda apagada. Pura. No muta la entrada.
 * Cualquier valor que no sea exactamente `true` (ausente, null, "true") apaga.
 */
export function aplicarCompuertaAgente(config: ConfigConductor): ConfigConductor {
  return config.agenteChoferHabilitado === true ? config : { ...config, activo: false };
}

export interface LecturaCompuerta { habilitado: boolean; razon: 'habilitado' | 'apagado' | 'compuerta_ilegible' }

type Enviar = (telefono: string, m: MensajeSaliente, contexto: string, tenantId: string, ahora: Date) => Promise<ResultadoEnvioConFallback>;

/**
 * Envuelve el envío del motor: lo que va al chofer pasa por la compuerta de la base; lo demás (escalaciones a supervisores) no.
 * Recuerda el veredicto por flota `ttlMs` para no consultar la base en cada mensaje de una pasada. Un «no» devuelve un rechazo NO
 * reintentable con el motivo legible; nunca llega a Meta ni a `wa_outbox`.
 */
export function conCompuertaAlChofer(
  enviar: Enviar, leer: (tenantId: string) => Promise<LecturaCompuerta>, opts: { ttlMs?: number; reloj?: () => number } = {},
): Enviar {
  const ttl = opts.ttlMs ?? 30_000;
  const reloj = opts.reloj ?? Date.now;
  const memo = new Map<string, { hasta: number; lectura: LecturaCompuerta }>();
  return async (telefono, m, contexto: string, tenantId, ahora) => {
    if (!esEnvioAlChofer(contexto)) return enviar(telefono, m, contexto, tenantId, ahora);
    let hit = memo.get(tenantId);
    if (!hit || hit.hasta <= reloj()) {
      let lectura: LecturaCompuerta;
      try { lectura = await leer(tenantId); } catch { lectura = { habilitado: false, razon: 'compuerta_ilegible' }; }
      hit = { hasta: reloj() + ttl, lectura };
      memo.set(tenantId, hit);
    }
    if (hit.lectura.habilitado) return enviar(telefono, m, contexto, tenantId, ahora);
    logger.warn('conductor.envio_bloqueado_agente_apagado', { tenant: tenantId, contexto, razon: hit.lectura.razon });
    return {
      ok: false, motivo: 'rechazo_no_ventana', fueraDeVentana: false, reintentable: false, ventana: 'desconocida',
      mensaje: hit.lectura.razon === 'compuerta_ilegible'
        ? 'No se envió: no se pudo comprobar que el Agente 5 esté habilitado para esta flota (migración 0859 sin aplicar o base sin respuesta).'
        : 'No se envió: el Agente 5 no está habilitado para esta flota (agente_chofer_habilitado = false).',
    };
  };
}
