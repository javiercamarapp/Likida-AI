// GUARDIA DETERMINÍSTICA (código, no prompt): el LLM NUNCA reporta cifras que no
// vengan de una tool en ese mismo turno. Si la respuesta trae cifras de dinero y
// NO hubo una llamada exitosa a cuadrar_viaje, se DESCARTA el texto del modelo y
// se responde con el cuadre REAL calculado por el motor. No depende de que el
// LLM obedezca — es el backstop de la regla fundacional (f/g).

import { cuadrarDesdeDB } from './desde_db';
import { resumenCuadre } from './resumen';
import { tieneCifrasDeDinero } from './cifras';
import type { ToolCallRecord } from '@/lib/llm/openrouter';

export async function guardiaCifras(
  reply: string,
  toolCalls: ToolCallRecord[],
  tenantId: string,
  viajeId: string,
): Promise<{ reply: string; forzado: boolean }> {
  const cuadroReal = toolCalls.some((t) => t.toolName === 'cuadrar_viaje' && !t.error);
  if (!cuadroReal && tieneCifrasDeDinero(reply)) {
    const liq = await cuadrarDesdeDB(tenantId, viajeId);
    return { reply: resumenCuadre(liq), forzado: true };
  }
  return { reply, forzado: false };
}
