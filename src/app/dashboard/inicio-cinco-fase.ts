import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import type { ClaveIconoAgente } from '@/app/ui-v2/componentes/icono-agente';

// ═══════════════════════════════════════════════════════════════════════════
// LA FASE REAL DE CADA AGENTE EN EL INICIO DE `cinco_agentes` (modelo puro, sin base ni red).
//
// Una fase es lo que SE PUEDE AFIRMAR con lo ya leído; ninguna se supone:
//   · corriendo     — hay una corrida SIN CERRAR (`fin` nulo) y empezó hace menos de 15 min;
//   · activo        — su última corrida cerró bien;
//   · atencion      — su última corrida falló o quedó con pendientes;
//   · sin_lectura   — no se pudo leer su última corrida (null ≠ «no corrió»);
//   · espera        — nunca corrió Y falta una conexión que las señales de la puesta en marcha SÍ pueden afirmar (0 archivos, sin TMS…);
//   · sin_corridas  — nunca corrió, o no registra corridas (su tablero es la fuente);
//   · proximamente  — fase 2 del perfil.
// ═══════════════════════════════════════════════════════════════════════════

export type FaseAgente = 'corriendo' | 'activo' | 'atencion' | 'sin_lectura' | 'espera' | 'sin_corridas' | 'proximamente';

/** Una corrida sin cerrar de hace más que esto no se afirma «corriendo»: pudo morirse sin cerrar (se cuenta como la última corrida). */
export const VENTANA_CORRIENDO_MS = 15 * 60_000;

export function faseDeAgente(
  corrida: CorridaRegistrada | null | undefined, ahora: number,
  o: { registraCorridas: boolean; proximamente?: boolean; esperaConexion?: boolean },
): FaseAgente {
  if (o.proximamente) return 'proximamente';
  if (!o.registraCorridas) return 'sin_corridas';
  if (corrida === null) return 'sin_lectura';
  if (corrida === undefined) return o.esperaConexion ? 'espera' : 'sin_corridas';
  const inicio = Date.parse(corrida.inicio);
  if (corrida.fin === null && corrida.estado === 'ok' && Number.isFinite(inicio) && ahora >= inicio && ahora - inicio < VENTANA_CORRIENDO_MS) return 'corriendo';
  return corrida.estado === 'ok' ? 'activo' : 'atencion';
}

/**
 * ¿Falta una conexión que se pueda AFIRMAR con las señales? Solo tres agentes dependen de algo que las señales miden; para los demás
 * `false` (no se inventa una espera). `null` en una señal = no se pudo leer = no se afirma.
 */
export function esperaConexionDe(clave: ClaveIconoAgente, s: SenalesAsistente | null): boolean {
  if (!s) return false;
  switch (clave) {
    case 'liquidacion': return s.tms === 'sin_credencial' && s.archivosRecibidos === 0;
    case 'peajes': return s.archivosRecibidos === 0;
    case 'conductor': return s.operadores !== null && s.operadores.activos === 0;
    default: return false;
  }
}
