// ═══════════════════════════════════════════════════════════════════════════
// ORÁCULO #8 — La bitácora registró lo que ocurrió.
//
// No inventa eventos nuevos: confirma que los que el propio código ya
// promete emitir (foto.ya_en_otro_viaje, huerfano.guardado, agent.run,
// guardia_cifras_*, etc.) se emitieron durante el escenario. Los eventos se
// capturan envolviendo el `logger` real en runtime (mismo objeto de módulo
// que usa src/ — sin tocar src/), así que aquí solo se compara.
// ═══════════════════════════════════════════════════════════════════════════

import type { EventoBitacora } from '../agentes/operador.qa';
import type { VeredictoOraculo } from '../config.qa';

export function oraculoBitacoraRegistro(
  eventos: EventoBitacora[],
  esperados: string[],
): VeredictoOraculo {
  const nombre = 'bitacora_registro (#8)';
  const emitidos = new Set(eventos.map((e) => e.msg));
  const faltantes = esperados.filter((msg) => !emitidos.has(msg));
  return faltantes.length === 0
    ? {
        oraculo: nombre, estado: 'ok',
        esperado: esperados,
        real: `los ${esperados.length} eventos esperados se emitieron (${eventos.length} eventos capturados en total)`,
      }
    : {
        oraculo: nombre, estado: 'fallo',
        esperado: esperados,
        real: `faltaron: ${faltantes.join(', ')}`,
        detalle: `capturados: ${[...emitidos].slice(0, 40).join(', ')}`,
      };
}
