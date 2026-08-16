// ═══════════════════════════════════════════════════════════════════════════
// ORÁCULO #5 — Ninguna cifra sin fuente.
//
// NO reimplementa la lógica: importa `cifrasRespaldadas`/`extraerNumeros` de
// src/lib/agents/analista.ts (el oráculo YA implementado en producción) y lo
// corre sobre lo que el agente Operador RECIBIÓ como respuesta por WhatsApp.
//
// El respaldo se construye con la MISMA `extraerNumeros` sobre las fuentes
// legítimas del turno: las filas reales de la DB del tenant (viaje, gastos,
// liquidación, huérfanos), el escenario sembrado y lo que el chofer escribió.
// Toda cifra de la respuesta debe estar ahí, ser un blanco (0-12, 50, 100) o
// derivada simple de dos respaldadas — exactamente la regla de producción.
// ═══════════════════════════════════════════════════════════════════════════

import { cifrasRespaldadas, extraerNumeros, type Bloque } from '@/lib/agents/analista';
import type { VeredictoOraculo } from '../config.qa';

/** El conjunto de respaldo: todos los números presentes en las fuentes. */
export function respaldoDesdeFuentes(fuentes: unknown[]): Set<number> {
  const respaldo = new Set<number>();
  for (const f of fuentes) extraerNumeros(f, respaldo);
  return respaldo;
}

export function oraculoCifrasConFuente(
  mensajesRecibidos: string[],
  respaldo: Set<number>,
): VeredictoOraculo {
  const nombre = 'cifras_con_fuente (#5)';
  if (mensajesRecibidos.length === 0) {
    return {
      oraculo: nombre, estado: 'no_verificado',
      esperado: 'al menos un mensaje del sistema que revisar',
      real: 'el agente Operador no recibió ningún mensaje',
    };
  }
  const sinRespaldo: string[] = [];
  for (const mensaje of mensajesRecibidos) {
    const bloques: Bloque[] = [{ tipo: 'texto', texto: mensaje }];
    if (!cifrasRespaldadas(bloques, respaldo)) sinRespaldo.push(mensaje.slice(0, 160));
  }
  return sinRespaldo.length === 0
    ? {
        oraculo: nombre, estado: 'ok',
        esperado: 'toda cifra respaldada por DB/escenario/chofer (o blanco/derivada)',
        real: `${mensajesRecibidos.length} mensajes verificados, 0 cifras huérfanas`,
      }
    : {
        oraculo: nombre, estado: 'fallo',
        esperado: 'toda cifra respaldada por una fuente',
        real: `${sinRespaldo.length} mensaje(s) con cifras sin fuente`,
        detalle: sinRespaldo.join(' ⏐ '),
      };
}
