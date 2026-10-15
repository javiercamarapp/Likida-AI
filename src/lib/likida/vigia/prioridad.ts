// ═══════════════════════════════════════════════════════════════════════════
// PRIORIDAD DEL MENSAJE — qué merece respuesta y qué se puede ignorar.
//
// Requisito (reunión del 14-oct, 00:00–01:42): palabras como «urgente» o ASAP
// y los signos de interrogación piden respuesta; los mensajes de monitoreo
// (listas de unidades detenidas), los «gracias / ok / enterado» y los stickers
// no necesitan que nadie conteste.
//
// Determinista a propósito (sin modelo): se puede explicar con `motivos`, que
// son categorías y NUNCA el texto del cliente.
//
// GUARDIA: la prioridad solo ORDENA y adelanta el aviso interno. Jamás dispara
// un envío al cliente ni cambia los umbrales de escalamiento.
//
// Estado de la medición: reglas validadas SOLO con mensajes sintéticos. La
// precisión sobre chats reales está SIN MEDIR (falta la muestra etiquetada B5).
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from './entrada';

export type NivelPrioridad = 0 | 1 | 2; // 0 ignorar · 1 normal · 2 alta

export type MotivoPrioridad =
  | 'urgencia'
  | 'pregunta'
  | 'monitoreo'
  | 'cortesia'
  | 'sticker'
  | 'adjunto_sin_texto'
  | 'apremio_negado'
  | 'sin_texto'
  | 'mensaje_normal';

export interface ContextoPrioridad {
  /** El mensaje trae archivo/imagen/audio. */
  adjunto?: boolean;
  /** El mensaje es un sticker. */
  sticker?: boolean;
}

export interface Prioridad {
  nivel: NivelPrioridad;
  /** Categorías para la bitácora y el tablero, NUNCA el texto del cliente. */
  motivos: MotivoPrioridad[];
}

// Sobre texto normalizado («a.s.a.p.» queda «a s a p»).
const URGENCIA: readonly RegExp[] = [
  /\b(asap|a s a p)\b/,
  /\b(urgente|urgentisimo|urgentisima|de urgencia)\b/,
  /\b(lo antes posible|cuanto antes|de inmediato|inmediatamente|ya mismo|ahorita mismo|para ya)\b/,
  /^(ya )+ya$/, // «ya ya»
];
// «ya» suelto solo cuenta con signo de exclamación (si no, es «ya vi»); se mira sobre el texto original.
const YA_EXCLAMADO = /(^|[\s¡])ya\s*!+\s*$/i;

// El apremio se niega expresamente: «ASAP no hace falta», «sin prisa».
const APREMIO_NEGADO = /\b(no (hace falta|es urgente|corre prisa|hay prisa|urge)|sin prisa|sin urgencia|no urge)\b/;

const PALABRAS_CORTESIA = new Set([
  'gracias', 'muchas', 'mil', 'ok', 'okay', 'okey', 'enterado', 'enterada', 'vale', 'listo', 'lista',
  'perfecto', 'recibido', 'de', 'acuerdo', 'entendido', 'sip', 'si', 'va', 'excelente', 'bien', 'buen', 'dia',
  'dias', 'tardes', 'noches', 'saludos', 'por', 'favor', 'sale', 'claro',
]);
const SOLO_EMOJI_CORTESIA = /^[\s\u{1F44D}\u{1F44C}\u{1F64F}\u{1F44F}\u{2705}\u{1F197}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]+$/u;

// Monitoreo: «UNIDAD … DETENIDA» (una o varias líneas), formato de los grupos de alerta.
const MONITOREO = /\bunidad\b[^\n]{0,80}\bdetenid[ao]s?\b/i;

function esSoloCortesia(normal: string): boolean {
  if (!normal) return false;
  const palabras = normal.split(' ');
  return palabras.length <= 8 && palabras.every((p) => PALABRAS_CORTESIA.has(p));
}

export function prioridadDe(texto: string, contexto: ContextoPrioridad = {}): Prioridad {
  const original = texto ?? '';
  const limpio = original.trim();

  if (contexto.sticker) return { nivel: 0, motivos: ['sticker'] };

  if (!limpio) {
    return contexto.adjunto
      ? { nivel: 1, motivos: ['adjunto_sin_texto'] }
      : { nivel: 0, motivos: ['sin_texto'] };
  }

  if (MONITOREO.test(limpio)) return { nivel: 0, motivos: ['monitoreo'] };

  if (SOLO_EMOJI_CORTESIA.test(limpio)) return { nivel: 0, motivos: ['cortesia'] };

  const normal = normalizar(limpio);
  const tieneUrgencia = URGENCIA.some((r) => r.test(normal)) || YA_EXCLAMADO.test(limpio);
  const pregunta = /[?¿]/.test(limpio);

  if (APREMIO_NEGADO.test(normal) && !pregunta) {
    // «gracias, ASAP no hace falta»: el apremio quedó cancelado; si además solo es cortesía, se ignora.
    const sinNegacion = normal.replace(APREMIO_NEGADO, ' ').replace(/\b(asap|a s a p|urgente)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!sinNegacion || esSoloCortesia(sinNegacion)) return { nivel: 0, motivos: ['apremio_negado', 'cortesia'] };
    return { nivel: 1, motivos: ['apremio_negado'] };
  }

  if (!pregunta && esSoloCortesia(normal)) return { nivel: 0, motivos: ['cortesia'] };

  const motivos: MotivoPrioridad[] = [];
  if (tieneUrgencia) motivos.push('urgencia');
  if (pregunta) motivos.push('pregunta');
  if (motivos.length) return { nivel: 2, motivos };

  return { nivel: 1, motivos: ['mensaje_normal'] };
}
