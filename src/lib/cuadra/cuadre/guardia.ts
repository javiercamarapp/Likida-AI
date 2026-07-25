// GUARDIA DETERMINÍSTICA (código, no prompt): el LLM NUNCA reporta cifras que no
// vengan de una tool en ese mismo turno. Es el backstop de la regla fundacional
// (f/g): no depende de que el modelo obedezca.
//
// Regla (por qué cada caso):
//  - Si llamó cuadrar_viaje → la respuesta ES sobre el cuadre. El LLM pudo
//    transcribir mal un número al narrarlo, así que se REEMPLAZA por el resumen
//    determinístico del motor (autoritativo). Cierra el hueco "tool llamada pero
//    número narrado incorrecto".
//  - Si NO llamó cuadrar_viaje NI consultar_politica pero hay cifras → números
//    ungrounded (inventados). Se da el cuadre real de la DB.
//  - Si solo consultó política y hay cifras → son topes/valores de la política
//    (grounded en una tool). Se deja el texto del modelo.
//  - FAIL-CLOSED: si no se puede calcular el cuadre real, NO se envían cifras;
//    se responde neutral en vez de arriesgar un número inventado.

import { cuadrarDesdeDB } from './desde_db';
import { resumenCuadre } from './resumen';
import { tieneCifrasDeDinero } from './cifras';
import { logger } from '@/lib/logger';
import type { ToolCallRecord } from '@/lib/llm/openrouter';

export async function guardiaCifras(
  reply: string,
  toolCalls: ToolCallRecord[],
  tenantId: string,
  viajeId: string,
): Promise<{ reply: string; forzado: boolean }> {
  if (!tieneCifrasDeDinero(reply)) return { reply, forzado: false };

  const cuadro = toolCalls.some((t) => t.toolName === 'cuadrar_viaje' && !t.error);
  const consultoPolitica = toolCalls.some((t) => t.toolName === 'consultar_politica' && !t.error);

  // Cifras grounded en política (topes) sin ser un cuadre → se respetan.
  if (!cuadro && consultoPolitica) return { reply, forzado: false };

  try {
    const liq = await cuadrarDesdeDB(tenantId, viajeId);
    // cerrado=cuadro: encabezado afirma el cierre solo si de verdad se cuadró.
    return { reply: resumenCuadre(liq, cuadro), forzado: true };
  } catch (err) {
    logger.error('guardia_cifras_fail_closed', { tenantId, viajeId, err: String(err) });
    return {
      reply: 'Dame un momento para cerrar bien tu cuadre y te confirmo los números. 🙏',
      forzado: true,
    };
  }
}
