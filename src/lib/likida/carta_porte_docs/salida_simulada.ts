// ═══════════════════════════════════════════════════════════════════════════
// SALIDA_TMS_SIMULADA (T-A3-42) — la demo de Carta Porte termina en «subido al TMS (simulado)», nunca en «subido».
//
// Es un puerto `SalidaTms` que ACEPTA toda plantilla sin tocar red ni sistema alguno. Solo lo usan las flotas que la
// operación declara sintéticas, una por una, en `SALIDA_TMS_SIMULADA` (lista de ids de flota separados por coma).
// Variable vacía o ausente = ninguna flota: una flota real jamás recibe el simulador por omisión.
// Lo simulado jamás se presenta como real: la tarjeta de envío lleva el rótulo `ROTULO_SIMULADO`.
// NO timbra, NO crea viajes y NO importa nada del camino del timbre.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import type { ResultadoCarga, SalidaTms } from './tms_puerto';

/** El rótulo visible en la tarjeta de envío. */
export const ROTULO_SIMULADO = 'Simulado';

/** Lo que dice la tarjeta cuando el envío «salió» por el simulador. */
export const FRASE_ENVIADO_SIMULADO = 'Subido al TMS (simulado). No se envió nada al sistema real del cliente.';

/** Prefijo de la referencia que devuelve el simulador: nunca se confunde con una real. */
export const PREFIJO_REFERENCIA_SIMULADA = 'SIMULADO-';

/** ¿Esta flota está declarada sintética para la salida simulada? Lee `SALIDA_TMS_SIMULADA` (ids separados por coma). */
export function esFlotaSimulada(tenantId: string, env: Record<string, string | undefined> = process.env): boolean {
  const ids = (env.SALIDA_TMS_SIMULADA ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return tenantId.trim() !== '' && ids.includes(tenantId.trim().toLowerCase());
}

/** El simulador: acepta, devuelve una referencia estable por llave (misma llave ⇒ misma referencia y `duplicado`). */
export function salidaSimulada(): SalidaTms {
  const vistas = new Set<string>();
  return {
    async cargarPlantilla(e): Promise<ResultadoCarga> {
      const referencia = PREFIJO_REFERENCIA_SIMULADA + createHash('sha256').update(e.idempotencyKey).digest('hex').slice(0, 8).toUpperCase();
      const duplicado = vistas.has(e.idempotencyKey);
      vistas.add(e.idempotencyKey);
      return { ok: true, referencia, duplicado };
    },
  };
}
