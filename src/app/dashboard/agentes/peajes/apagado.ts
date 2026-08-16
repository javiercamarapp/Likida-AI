import { estaApagado } from '@/lib/likida/interruptores';

// ═══════════════════════════════════════════════════════════════════════════
// EL KILL SWITCH DEL AGENTE DE PEAJES (0110) — Fase 1 del blueprint.
//
// `agente:peajes` existía en el catálogo y NINGÚN call site lo preguntaba.
// Este agente no corre por reloj: sus corridas las disparan las CUATRO
// server actions de la página (subir consolidado, importar+cruzar desglose,
// re-conciliar, barrido por_conciliar). La palanca vive en UN solo punto que
// las cuatro consultan — no cuatro `estaApagado` regados: el conteo de call
// sites reales (13, ver el blueprint) es la prueba de que no se coló ninguno
// de más ni faltó uno.
//
// Va DESPUÉS de la puerta de sesión/rol de cada action (quien no puede
// operar el agente tampoco debe poder sondear si está apagado) y ANTES de
// tocar archivo o base. Fail-closed: si el interruptor no se puede LEER,
// no se concilia (`estaApagado` devuelve apagado con grito en el log).
// ═══════════════════════════════════════════════════════════════════════════

/** El aviso para pantalla si el agente está apagado, o `null` si puede
 *  trabajar. Los archivos ya guardados no se pierden: conciliar es anotación
 *  recalculable (ver desglose_peaje.ts) y se re-corre al encender. */
export async function avisoAgentePeajesApagado(): Promise<string | null> {
  if (await estaApagado('agente:peajes')) {
    return 'El agente de Peajes está apagado desde la consola de Likida. '
      + 'Ninguna conciliación corre hasta que lo enciendan; lo ya guardado no se pierde y el cruce se puede re-correr después.';
  }
  return null;
}
