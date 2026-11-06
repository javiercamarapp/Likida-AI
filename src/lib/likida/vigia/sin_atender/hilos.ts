// Segmentación en hilos abiertos: mensajes sustantivos del cliente que el equipo aún no atendió.
import { normalizar } from '../entrada';
import { prioridadDe } from '../prioridad';
import { msDe } from './mensajes';
import { apremioNegado, contienePalabra } from './palabras';
import type { MensajeChat } from './tipos';

export interface ItemAbierto {
  ms: number;
  urgente: boolean;
  pregunta: boolean;
  clave: boolean;
  /** Texto ya limpio; solo sirve para la vista previa acotada. */
  texto: string;
}

export interface PalabrasCompiladas { urgentes: readonly string[]; clave: readonly string[] }

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
export function segmentarHilos(mensajes: readonly MensajeChat[], ventanaRespuestaMin: number | null, palabras: PalabrasCompiladas): Segmentacion {
  const hilos: ItemAbierto[][] = [];
  let actual: ItemAbierto[] = [];
  let ignorados = 0;
  let hayEquipo = false;
  const ventanaMs = ventanaRespuestaMin === null ? null : ventanaRespuestaMin * 60_000;

  for (const m of mensajes) {
    const ms = msDe(m.enviadoEn);
    if (m.rol === 'equipo') {
      hayEquipo = true;
      if (actual.length === 0) continue;
      if (ventanaMs === null) { actual = []; continue; }
      const tardios = actual.filter((i) => ms - i.ms > ventanaMs);
      if (tardios.length) hilos.push(tardios);
      actual = [];
      continue;
    }
    const p = prioridadDe(m.texto, { adjunto: m.adjunto === true });
    if (p.nivel === 0) {
      ignorados += 1;
      if (p.motivos.includes('cortesia')) actual = [];
      continue;
    }
    const normal = normalizar(m.texto);
    const negado = apremioNegado(normal);
    actual.push({
      ms,
      urgente: p.motivos.includes('urgencia') || (!negado && contienePalabra(normal, palabras.urgentes)),
      pregunta: p.motivos.includes('pregunta'),
      clave: contienePalabra(normal, palabras.clave),
      texto: m.texto,
    });
  }
  if (actual.length) hilos.push(actual);
  return { hilos, ignorados, hayEquipo };
}
