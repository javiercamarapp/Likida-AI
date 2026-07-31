// ═══════════════════════════════════════════════════════════════════════════
// Cómo se le cuenta al contralor dónde va el ejercicio.
//
// El motor no puede hacerlo: es puro y evalúa un viaje. Esto traduce el estado
// del contador a una frase que se pueda leer sin ser fiscalista, y sobre todo
// ACCIONABLE — el contralor no necesita saber que va al 12.4%, necesita saber
// que le quedan $3,000 de margen y qué hacer con ellos.
// ═══════════════════════════════════════════════════════════════════════════

import type { ResultadoTope15 } from './combustible';
import { TOPE_EFECTIVO } from './combustible';
import { mxn } from '@/lib/formato';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Frase para el contralor, o `null` si no hay nada que decir.
 *
 * En `holgado` devuelve null a propósito: un aviso que sale siempre deja de
 * leerse, y con él dejan de leerse los que importan.
 */
export function avisoTope15(r: ResultadoTope15, ejercicio: number): string | null {
  switch (r.estado) {
    case 'holgado':
      return null;

    case 'cerca':
      // Lo accionable va primero. El porcentaje es contexto, no la noticia.
      return `Diésel en efectivo ${ejercicio}: te quedan ${mxn(r.margen)} antes de perder la deducción. Vas en ${pct(r.razon)} del ${pct(TOPE_EFECTIVO)} que permite la RFA 2026 regla 2.9. A partir de ahí conviene pagar con tarjeta o transferencia.`;

    case 'excedido':
      // Se dice el excedente AGREGADO, no se señala un comprobante: cuál pago
      // "es" el excedente no lo resuelve ninguna fuente, y adivinarlo sería
      // marcarle a alguien un ticket concreto como culpable sin fundamento.
      return `Diésel en efectivo ${ejercicio}: te pasaste del ${pct(TOPE_EFECTIVO)} que permite la RFA 2026 regla 2.9. ${mxn(r.excedente)} del efectivo del ejercicio ya no son deducibles. Cuál comprobante concreto queda fuera lo decide tu contador — el excedente es del ejercicio, no de un ticket.`;

    case 'sin_criterio':
      return `Diésel en efectivo ${ejercicio}: hay pagos en efectivo pero no se pudo calcular el total de combustible del ejercicio, así que no se evaluó el 15% de la RFA 2026 regla 2.9. Conviene revisarlo a mano.`;
  }
}
