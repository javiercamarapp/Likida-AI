// ═══════════════════════════════════════════════════════════════════════════
// QUÉ HACER con una foto ya extraída.
//
// Vive fuera del processor a propósito: allá adentro esta decisión queda pegada
// a Supabase, WhatsApp y Redis, y es justo la parte donde se decide si el dinero
// entra una vez, dos, o ninguna. Aquí es una función pura y se puede probar.
// ═══════════════════════════════════════════════════════════════════════════

import type { Gasto } from '@/types/cuadra';
import type { ExtraerResultado } from './ocr';
import { emparejarPorMonto } from './emparejar';

export type AccionFoto =
  /** Comprobante completo: alta normal. */
  | { accion: 'alta' }
  /** Acercamiento que encontró su comprobante: le pega folio, código y liga. */
  | { accion: 'enriquecer'; gastoId: string }
  /** Trae código pero no hay comprobante al cual pegarlo (o hay más de uno). */
  | { accion: 'pedir_ticket' }
  /** La foto de verdad no se lee: reenviarla con mejor luz sirve. */
  | { accion: 'pedir_reenvio' }
  /** Falló nuestro lado: reenviar la misma foto falla igual. */
  | { accion: 'avisar_falla' };

export function decidirFoto(r: ExtraerResultado, gastos: Gasto[]): AccionFoto {
  if (r.legible) return { accion: 'alta' };
  if (r.motivo === 'fallo_tecnico') return { accion: 'avisar_falla' };
  if (r.motivo === 'solo_codigo') {
    const destino = emparejarPorMonto(r.gasto.monto, gastos);
    // Sin destino único NO se da de alta: un acercamiento por su cuenta vale el
    // mismo dinero que el ticket que le corresponde, y sumar los dos infla la
    // liquidación. Se le pide la foto del ticket y no se pierde nada.
    return destino ? { accion: 'enriquecer', gastoId: destino.id } : { accion: 'pedir_ticket' };
  }
  return { accion: 'pedir_reenvio' };
}
