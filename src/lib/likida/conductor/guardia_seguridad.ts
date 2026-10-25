import { normalizar } from './interprete';
import type { Salida } from './mensajes';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDIA DE DATOS DE SEGURIDAD (T-A5-58) — la clave de amago y el botón de pánico NO van por WhatsApp.
//
// Quedan con monitoreo (R08). Si un chofer teclea una, el texto no se interpreta, no se guarda (hito, evidencia, memoria
// del agente) ni se registra en el log: se contesta una frase fija que NO lo repite y se corta ahí. Pura, sin red ni base.
// Aplica en TODOS los perfiles (no depende de la perilla de fase 2).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formas ya normalizadas (minúsculas, sin acentos ni puntuación) que se buscan como PALABRAS COMPLETAS: «panicoso» o
 * «amago de lluvia» no cuentan. Configurable: `contieneDatoDeSeguridad(texto, otraLista)`.
 */
export const TERMINOS_SEGURIDAD: readonly string[] = [
  'clave de amago', 'clave amago', 'clave del amago', 'clave del mago', 'codigo de amago', 'palabra de amago', 'contrasena de amago',
  'boton de panico', 'boton panico', 'clave de panico', 'panico',
];

/**
 * A37-A5-12: «pánico» a secas es un dato sensible SOLO cuando el mensaje es esa palabra (o casi): «siento pánico, hay gente rara
 * rondando el camión» es una frase de angustia, no una clave, y cortarla con «repórtala a monitoreo» dejaba al chofer sin que nadie
 * se enterara. Esas frases siguen su camino hacia el reconocedor de asistencia (`interpretarAsistencia`).
 */
const TERMINOS_SOLO_SI_CORTOS: readonly string[] = ['panico'];
const MAX_PALABRAS_TERMINO_SUELTO = 2;

export const TEXTO_CLAVE_NO_AQUI = 'Esa clave no se manda por aquí; repórtala a monitoreo. 🙏';

export function contieneDatoDeSeguridad(texto: string | null | undefined, terminos: readonly string[] = TERMINOS_SEGURIDAD): boolean {
  if (typeof texto !== 'string' || !texto) return false;
  const limpio = normalizar(texto);
  const t = ` ${limpio} `;
  const palabras = limpio.split(' ').filter(Boolean).length;
  return terminos.some((x) => {
    const n = normalizar(x);
    if (!t.includes(` ${n} `)) return false;
    return !TERMINOS_SOLO_SI_CORTOS.includes(n) || palabras <= MAX_PALABRAS_TERMINO_SUELTO;
  });
}

/** `null` = el texto no es sensible. Si lo es, la salida al chofer (sin repetir nada de lo que escribió). */
export function guardiaDatosSeguridad(texto: string | null | undefined): Salida | null {
  return contieneDatoDeSeguridad(texto) ? { texto: TEXTO_CLAVE_NO_AQUI } : null;
}
