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
//  - Si solo consultó política y hay cifras → se COTEJA cifra por cifra contra
//    lo que la tool devolvió. Antes bastaba con que la llamada existiera, y eso
//    era una puerta trasera: consultar la política —barata y siempre
//    disponible— desbloqueaba narrar cualquier número, incluido un cuadre
//    inventado colado en la misma frase que un tope real.
//  - FAIL-CLOSED: si no se puede calcular el cuadre real, NO se envían cifras;
//    se responde neutral en vez de arriesgar un número inventado.

import { cuadrarDesdeDB } from './desde_db';
import { resumenCuadre } from './resumen';
import { tieneCifrasDeDinero, cifrasSinRespaldo } from './cifras';
import { logger } from '@/lib/logger';
import type { ToolCallRecord } from '@/lib/llm/openrouter';

export async function guardiaCifras(
  reply: string,
  toolCalls: ToolCallRecord[],
  tenantId: string,
  viajeId: string,
): Promise<{ reply: string; forzado: boolean }> {
  const cuadro = toolCalls.some((t) => t.toolName === 'cuadrar_viaje' && !t.error);
  const consultoPolitica = toolCalls.some((t) => t.toolName === 'consultar_politica' && !t.error);

  // El detector NO decide sobre un cuadre. Antes esta función salía en la primera
  // línea si `tieneCifrasDeDinero` decía que no, lo que ponía a un regex —que por
  // definición tiene falsos negativos— a decidir sobre el caso más importante: el
  // turno en que SÍ se calculó el cuadre. Si el modelo cuadraba y narraba el
  // resultado de una forma que el detector no reconocía, el texto salía sin
  // verificar. Y ese es el camino feliz de la demo: foto → "listo" → el agente
  // narra.
  //
  // Cuando hubo cuadre, la respuesta ES sobre el cuadre y se sustituye siempre.
  if (!cuadro && !tieneCifrasDeDinero(reply)) return { reply, forzado: false };

  // Cifras de política sin ser un cuadre: se respetan SOLO las que de verdad
  // salieron de la tool. Basta una cifra sin respaldo para no confiar en el
  // texto completo — no se puede tachar el número malo y mandar el resto.
  if (!cuadro && consultoPolitica) {
    const respaldos = toolCalls.filter((t) => !t.error).map((t) => t.result);
    const fuera = cifrasSinRespaldo(reply, respaldos);
    if (fuera.length === 0) return { reply, forzado: false };
    logger.warn('guardia_cifras_sin_respaldo', { tenantId, viajeId, cifras: fuera });
  }

  try {
    const liq = await cuadrarDesdeDB(tenantId, viajeId);
    // cerrado=cuadro: encabezado afirma el cierre solo si de verdad se cuadró.
    //
    // 'operador' NO es opcional aquí: esta respuesta va por WhatsApp AL CHOFER, y
    // sin el destinatario caía al default 'contralor' — mandándole veredictos que
    // él no puede arreglar (proveedor en lista 69-B, CFDI cancelado, RFC receptor)
    // más el descargo legal. Y pasa en el CAMINO FELIZ: foto → "listo" → el agente
    // narra → la guardia reemplaza. O sea, delante del comprador en el demo.
    return { reply: resumenCuadre(liq, cuadro, 'operador'), forzado: true };
  } catch (err) {
    logger.error('guardia_cifras_fail_closed', { tenantId, viajeId, err: String(err) });
    return {
      reply: 'Dame un momento para cerrar bien tu cuadre y te confirmo los números. 🙏',
      forzado: true,
    };
  }
}
