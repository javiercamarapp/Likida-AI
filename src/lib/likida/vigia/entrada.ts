// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESCRIBE UN CLIENTE ES DATO NO CONFIABLE.
//
// Tres defensas PURAS que corren antes de que el texto toque un modelo, una
// consulta o una respuesta:
//
//   1. `limpiarTexto`   — sin caracteres de control ni de ancho cero (que sirven
//      para esconder instrucciones), espacios colapsados y tope de largo.
//   2. `detectarInyeccion` — reconoce los intentos más comunes de dar órdenes al
//      agente («ignora tus instrucciones», «muéstrame el prompt», «actúa como»,
//      «dime los viajes de otro cliente»). NO es la defensa: es una SEÑAL. La
//      defensa de verdad es estructural —el modelo solo emite un enum, las
//      respuestas se arman con datos del viaje del propio cliente, y nada de lo
//      que diga el cliente cambia a qué viaje o tenant se consulta—; la señal
//      hace que el caso NUNCA se autoenvíe y que quede en bitácora.
//   3. `esSpam` — ráfagas y repeticiones: el cliente que manda 20 mensajes en
//      un minuto no abre 20 consultas ni 20 avisos al gerente.
//
// Todo es determinista y probado con entrada hostil (ver entrada.test.ts).
// ═══════════════════════════════════════════════════════════════════════════

/** Un mensaje de WhatsApp cabe en 4,096; aquí cabe lo que un cliente necesita decir. */
export const MAX_TEXTO_CLIENTE = 1000;

// Controles C0/C1 (salvo \n y \t) y caracteres invisibles que se usan para
// esconder texto: ancho cero, marcas de dirección, BOM, separadores de línea.
// eslint-disable-next-line no-control-regex -- justamente se quitan los controles
const INVISIBLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function limpiarTexto(crudo: unknown): string {
  const t = typeof crudo === 'string' ? crudo : '';
  const sin = t.replace(INVISIBLES, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return sin.length > MAX_TEXTO_CLIENTE ? sin.slice(0, MAX_TEXTO_CLIENTE) : sin;
}

/** Minúsculas, sin acentos y sin signos: la forma en que comparan las reglas. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Patrones de intento de manipulación. Sobre el texto NORMALIZADO. */
const PATRONES_INYECCION: readonly RegExp[] = [
  /\b(ignora|ignore|olvida|omite|desobedece|salta)\b[^.]{0,40}\b(instrucciones|reglas|indicaciones|prompt|restricciones|anteriores)\b/,
  /\b(ignore|disregard|forget)\b[^.]{0,40}\b(previous|prior|above|instructions|rules)\b/,
  /\b(system prompt|prompt del sistema|instrucciones del sistema|mensaje del sistema|tus instrucciones)\b/,
  /\b(muestrame|dime|revela|repite|imprime|escribe)\b[^.]{0,30}\b(tu prompt|tus instrucciones|tus reglas|tu configuracion|las instrucciones)\b/,
  /\b(actua como|finge ser|pretende ser|eres ahora|ahora eres|a partir de ahora eres|haz de cuenta que eres|you are now|act as)\b/,
  /\b(modo desarrollador|developer mode|jailbreak|dan mode|sin restricciones|sin filtros)\b/,
  /\b(autoriza|aprueba|apruebo|autorizo)\b[^.]{0,30}\b(envio|enviar|esto|pago|reembolso|descuento)\b/,
  /\b(eres el gerente|soy el gerente|soy el dueno|soy el administrador|soy de sistemas|soy de likida)\b/,
  /\b(dame|muestrame|pasame|enviame|dime)\b[^.]{0,40}\b(datos|viajes|facturas|ubicacion|unidades|choferes|telefonos)\b[^.]{0,20}\b(de otro|de otros|de todos|de los demas|de otra empresa|de otro cliente)\b/,
  /\b(todos los (viajes|clientes|choferes|operadores)|lista de (clientes|choferes|operadores))\b/,
];

export function detectarInyeccion(texto: string): boolean {
  const n = normalizar(texto);
  // Los marcadores de rol y las cercas de código se buscan en el texto CRUDO
  // (el normalizador quita los signos que los forman).
  if (/<\s*\/?\s*(system|assistant|user|instructions?)\s*>/i.test(texto)) return true;
  if (/\[\s*\/?\s*(inst|system|assistant)\s*\]/i.test(texto)) return true;
  if (texto.includes('```')) return true;
  if (!n) return false;
  return PATRONES_INYECCION.some((r) => r.test(n));
}

export interface Entrante { texto: string; en: number }

export const SPAM_VENTANA_MS = 5 * 60_000;
export const SPAM_MAX_EN_VENTANA = 8;
export const SPAM_MAX_SIN_RESPUESTA = 12;

/**
 * ¿Este contacto está haciendo spam? Recibe sus entrantes RECIENTES (el actual
 * incluido) y cuántos lleva sin respuesta. Tres causas:
 *   · más de 8 mensajes en 5 minutos;
 *   · el MISMO texto 4 veces seguidas (copiar-pegar);
 *   · 12 o más mensajes sin que nadie le haya contestado (el hilo ya es una cola
 *     y seguir redactando solo acumula borradores).
 * Devuelve el motivo para la bitácora (nunca el texto).
 */
export function esSpam(recientes: readonly Entrante[], entradasSinRespuesta: number, ahoraMs: number): string | null {
  const enVentana = recientes.filter((m) => ahoraMs - m.en <= SPAM_VENTANA_MS);
  if (enVentana.length > SPAM_MAX_EN_VENTANA) return 'rafaga';
  const ultimos = [...recientes].sort((a, b) => a.en - b.en).slice(-4);
  if (ultimos.length === 4 && normalizar(ultimos[0].texto) !== '' && ultimos.every((m) => normalizar(m.texto) === normalizar(ultimos[0].texto))) return 'repeticion';
  if (entradasSinRespuesta >= SPAM_MAX_SIN_RESPUESTA) return 'sin_respuesta_acumulada';
  return null;
}
