// Segmentación en hilos abiertos: mensajes sustantivos del cliente que el equipo aún no atendió.
import { normalizar } from '../entrada';
import { esPeticion } from '../peticion';
import { prioridadDe } from '../prioridad';
import { esRespuestaVacia } from '../respuesta_vacia';
import { msDe } from './mensajes';
import { apremioNegado, contienePalabra } from './palabras';
import type { MensajeChat } from './tipos';

export interface ItemAbierto {
  ms: number;
  urgente: boolean;
  pregunta: boolean;
  clave: boolean;
  /** El mensaje pide algo (peticion.ts): pregunta, ruego o solicitud reconocible. */
  peticion: boolean;
  /** Texto ya limpio; solo sirve para la vista previa acotada. */
  texto: string;
}

export interface PalabrasCompiladas { urgentes: readonly string[]; clave: readonly string[] }

/** Opciones OPCIONALES (apagadas = comportamiento de siempre). Ver `ConfigSinAtender`. */
export interface OpcionesHilos {
  /** Un acuse vacío del equipo («enterado», «reviso») no cierra el pendiente. */
  acusesVaciosNoCierran?: boolean;
  /** Un «gracias» del cliente cierra el hilo solo si llegó al menos estos minutos después del último mensaje abierto. */
  cortesiaCierraTrasMin?: number;
}

export interface Segmentacion {
  hilos: ItemAbierto[][];
  /** Mensajes de cliente ignorados (cortesía, monitoreo, sticker, vacío). */
  ignorados: number;
  /** ¿Hay al menos un mensaje del equipo? Sin él no se sabe quién es quién. */
  hayEquipo: boolean;
}

/**
 * `mensajes` ya pasó por prepararMensajes (orden total). Reglas:
 *  · un mensaje del equipo cierra lo pendiente (dentro de `ventanaRespuestaMin` si existe; lo que quede fuera de ventana
 *    queda abierto como hilo aparte, porque una respuesta tardía no cuenta);
 *  · un «gracias/ok» del cliente después de lo pendiente lo da por cerrado (el cliente mismo cerró la conversación);
 *  · cortesía, monitoreo, sticker y vacío no abren nada.
 */
export function segmentarHilos(mensajes: readonly MensajeChat[], ventanaRespuestaMin: number | null, palabras: PalabrasCompiladas, opciones: OpcionesHilos = {}): Segmentacion {
  const hilos: ItemAbierto[][] = [];
  let actual: ItemAbierto[] = [];
  let ignorados = 0;
  let hayEquipo = false;
  const ventanaMs = ventanaRespuestaMin === null ? null : ventanaRespuestaMin * 60_000;
  const cortesiaMs = Math.max(0, opciones.cortesiaCierraTrasMin ?? 0) * 60_000;

  for (const m of mensajes) {
    const ms = msDe(m.enviadoEn);
    if (m.rol === 'equipo') {
      hayEquipo = true;
      if (actual.length === 0) continue;
      // Un acuse sin dato no es atención: el pendiente sigue abierto (solo si la flota lo pidió).
      if (opciones.acusesVaciosNoCierran && esRespuestaVacia(m.texto)) continue;
      if (ventanaMs === null) { actual = []; continue; }
      const tardios = actual.filter((i) => ms - i.ms > ventanaMs);
      if (tardios.length) hilos.push(tardios);
      actual = [];
      continue;
    }
    const p = prioridadDe(m.texto, { adjunto: m.adjunto === true });
    if (p.nivel === 0) {
      ignorados += 1;
      // El «gracias» pegado a la petición (misma ráfaga) es cortesía de la petición, no el cierre de la conversación.
      if (p.motivos.includes('cortesia') && !(cortesiaMs > 0 && actual.length > 0 && ms - actual[actual.length - 1].ms < cortesiaMs)) actual = [];
      continue;
    }
    const normal = normalizar(m.texto);
    const negado = apremioNegado(normal);
    actual.push({
      ms,
      urgente: p.motivos.includes('urgencia') || (!negado && contienePalabra(normal, palabras.urgentes)),
      pregunta: p.motivos.includes('pregunta'),
      clave: contienePalabra(normal, palabras.clave),
      peticion: esPeticion(m.texto),
      texto: m.texto,
    });
  }
  if (actual.length) hilos.push(actual);
  return { hilos, ignorados, hayEquipo };
}
