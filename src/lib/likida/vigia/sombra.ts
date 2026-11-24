// ═══════════════════════════════════════════════════════════════════════════
// MODO SOMBRA de `decidirAccion` (agente 4, producción).
//
// Con `VIGIA_SOMBRA_DECISION` encendida, el servicio corre `decidirAccion` sobre el mensaje del cliente y el borrador ya armado
// y SOLO REGISTRA la decisión en el `detalle` del evento `borrador`. No cambia el texto, la prioridad, la política de envío ni
// el escalamiento: es observación para comparar la matriz contra lo que hace hoy el agente antes de dejarla actuar.
//
// Garantías:
//   · Apagado por omisión: sin la variable (o con cualquier valor distinto de «si» / lista de flotas) no se calcula nada.
//   · Nunca lanza: si `decidirAccion` falla se falla CERRADO (se anota «escalar a persona», sin actuar) y se registra el error.
//   · Solo puede ENDURECER y solo lo anota: «escalar a persona» o «no responder» quedan en el registro con `aplicado: false`.
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════
import { decidirAccion, type EntradaDecision } from './conocimiento/decidir';
import type { Accion } from './conocimiento/matriz_accion';

/**
 * `si` (o `true`/`1`) = todas las flotas. Cualquier otro texto no vacío se lee como lista de ids de flota separados por comas.
 * Vacío, ausente o `no` = apagado.
 */
export function sombraActiva(valor: string | undefined | null, tenantId: string): boolean {
  const v = (valor ?? '').trim().toLowerCase();
  if (!v || v === 'no' || v === 'false' || v === '0') return false;
  if (v === 'si' || v === 'true' || v === '1') return true;
  return v.split(',').map((s) => s.trim()).filter(Boolean).includes(tenantId.trim().toLowerCase());
}

const NO_RESPONDER: readonly Accion[] = ['prohibido', 'solo_registrar'];
const ESCALAR: readonly Accion[] = ['escalar_gerente', 'avisar_encargado', 'pedir_dato_a_persona'];

export interface DecisionSombra {
  accionSugerida: Accion;
  motivo: string;
  /** Reglas de la matriz que intervinieron: `tipo:motivo`. */
  regla: string[];
  nivelAviso: string | null;
  camposFaltantes: string[];
  /** La decisión pide una persona o no responder (más estricta que contestar con datos). */
  endurece: 'escalar' | 'no_responder' | null;
  /** Siempre `false`: el modo sombra no actúa. */
  aplicado: false;
  /** Presente solo si `decidirAccion` falló; entonces `accionSugerida` es la salida cerrada. */
  error?: string;
}

export function evaluarDecisionSombra(entrada: EntradaDecision): DecisionSombra {
  try {
    const d = decidirAccion(entrada);
    return {
      accionSugerida: d.accion,
      motivo: d.motivo,
      regla: d.desglose.map((x) => `${x.tipo}:${x.motivo}`),
      nivelAviso: d.nivelAviso,
      camposFaltantes: d.camposFaltantes,
      endurece: NO_RESPONDER.includes(d.accion) ? 'no_responder' : ESCALAR.includes(d.accion) ? 'escalar' : null,
      aplicado: false,
    };
  } catch (e) {
    return {
      accionSugerida: 'escalar_gerente', motivo: 'decision_sombra_fallo', regla: [], nivelAviso: null, camposFaltantes: [],
      endurece: 'escalar', aplicado: false, error: e instanceof Error ? e.message.slice(0, 200) : 'desconocido',
    };
  }
}
