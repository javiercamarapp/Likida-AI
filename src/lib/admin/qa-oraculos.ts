// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA — los oráculos. SOLO servidor.
//
// NO se reescribe ni un oráculo: se IMPORTAN los de la Fase 1 del ejército
// (scripts/qa-agentes/oraculos/*) — el mismo código juzga la corrida del
// panel y la corrida nocturna. Este módulo solo (a) los adapta a la fila de
// tabla que pinta la pantalla y (b) fija la metadata de invariante/severidad,
// con los MISMOS valores que INVARIANTE_DE del orquestador (no se puede
// importar de ahí: orquestador.qa.ts es un archivo de vitest).
//
// QUÉ SE CORRE Y QUÉ NO. #1, #5 y #8 los ejercita cualquier corrida (todas
// cuadran, hablan y registran). #3 (dedup) solo lo ejercita el escenario cuyo
// guion REPITE una foto — por eso llega por `dedup`, y sin ese dato no se
// corre. Correrlo sobre un escenario que no lo ataca y reportar "ok" sería un
// veredicto inventado, que es exactamente lo que este panel existe para no
// hacer.
//
// huerfano_post_cierre (#4) YA DISPARA (antes: importado y mudo). Lo que le
// faltaba era el MONTO del ticket que llegó tarde, y ese dato existe desde
// que el banco tiene verdad-de-terreno confirmada (`qa_foto.ocr_esperado`,
// migs. 0185/0239, 90 fotos etiquetadas y auditadas): el escenario
// `ticket_tarde` manda la última foto DESPUÉS del cierre, el motor guarda los
// totales de la liquidación de ANTES del ataque y el monto etiquetado de esa
// foto, y #4 juzga con ellos. Sin ese material (`huerfano` ausente) #4 sigue
// sin correr — juzgarlo sobre un guion que no lo ataca sería un veredicto
// inventado, igual que #3.
// ═══════════════════════════════════════════════════════════════════════════

import { oraculoCuadreBalancea } from '../../../scripts/qa-agentes/oraculos/cuadre_balancea.oraculo';
import { oraculoHuerfanoPostCierre } from '../../../scripts/qa-agentes/oraculos/huerfano_post_cierre.oraculo';
import { oraculoDedupComprobante } from '../../../scripts/qa-agentes/oraculos/dedup_comprobante.oraculo';
import { oraculoCifrasConFuente, respaldoDesdeFuentes } from '../../../scripts/qa-agentes/oraculos/cifras_con_fuente.oraculo';
import { oraculoBitacoraRegistro } from '../../../scripts/qa-agentes/oraculos/bitacora_registro.oraculo';
import type { VeredictoOraculo } from '../../../scripts/qa-agentes/config.qa';
import type { FilaVeredicto } from './qa-tipos';

export type { VeredictoOraculo };

/** Mismos rótulos y severidades que INVARIANTE_DE de
 *  scripts/qa-agentes/orquestador.qa.ts — una sola verdad, dos consumidores. */
export const INVARIANTES: Record<string, { linea: string; severidad: string }> = {
  'cuadre_balancea (#1)': { linea: '#1  anticipo − gastos = diferencia', severidad: 'CRÍTICO' },
  'dedup_comprobante (#3)': { linea: '#3  un comprobante = un gasto (dedup)', severidad: 'ALTO' },
  'huerfano_post_cierre (#4)': { linea: '#4  ticket post-cierre → huérfanos', severidad: 'ALTO' },
  'cifras_con_fuente (#5)': { linea: '#5  ninguna cifra sin fuente', severidad: 'MEDIO' },
  'bitacora_registro (#8)': { linea: '#8  bitácora registró lo ocurrido', severidad: 'MEDIO' },
};

export function filaDesdeVeredicto(v: VeredictoOraculo): FilaVeredicto {
  const meta = INVARIANTES[v.oraculo];
  return {
    invariante: meta?.linea ?? v.oraculo,
    oraculo: v.oraculo,
    estado: v.estado,
    severidad: meta?.severidad ?? '—',
    esperado: v.esperado,
    real: v.real,
    detalle: v.detalle,
  };
}

export interface EntradaOraculos {
  tenantId: string;
  viajeId: string;
  /** Lo que el sistema le contestó al chofer (turnos assistant de
   *  wa_conversacion) — el material del oráculo #5. */
  textosBot: string[];
  /** Fuentes legítimas de cifras: filas reales del tenant + parámetros de la
   *  corrida + lo que el chofer escribió. */
  fuentesRespaldo: unknown[];
  /** Eventos capturados del logger durante la corrida (oráculo #8). */
  eventosBitacora: Array<{ msg: string }>;
  /** Qué eventos DEBIERON emitirse en este escenario. */
  eventosEsperados: string[];
  /** Solo si el guion repitió una foto: el hash de esa foto y el viaje al que
   *  intentó entrar la segunda vez. Sin esto, #3 no se corre. */
  dedup?: { imgHash: string; viajeIntentoId: string };
  /** Solo si el guion mandó un ticket TRAS el cierre (escenario ticket_tarde):
   *  los totales que la liquidación tenía ANTES del ataque y el monto del
   *  ticket tardío según la verdad-de-terreno de esa foto. Sin esto, #4 no se
   *  corre — no se le inventa una cifra al ticket. */
  huerfano?: {
    liqSembrada: { totalComprobado: number; totalAnticipo: number; diferencia: number };
    montoTicket: number;
  };
}

/** Corre los oráculos que la corrida DE VERDAD ejercitó y devuelve las filas
 *  del veredicto. Funciones puras sobre la DB — el LLM explora, el código
 *  juzga. */
export async function correrOraculos(e: EntradaOraculos): Promise<FilaVeredicto[]> {
  const filas: FilaVeredicto[] = [];

  filas.push(filaDesdeVeredicto(
    await oraculoCuadreBalancea(e.tenantId, e.viajeId, { esperaLiquidacion: true }),
  ));

  const respaldo = respaldoDesdeFuentes(e.fuentesRespaldo);
  filas.push(filaDesdeVeredicto(oraculoCifrasConFuente(e.textosBot, respaldo)));

  if (e.dedup) {
    filas.push(filaDesdeVeredicto(
      await oraculoDedupComprobante(e.tenantId, e.dedup.viajeIntentoId, e.dedup.imgHash),
    ));
  }

  if (e.huerfano) {
    filas.push(filaDesdeVeredicto(
      await oraculoHuerfanoPostCierre(e.tenantId, e.viajeId, {
        liqSembrada: e.huerfano.liqSembrada,
        montoTicket: e.huerfano.montoTicket,
      }),
    ));
  }

  filas.push(filaDesdeVeredicto(oraculoBitacoraRegistro(
    // El oráculo solo mira `msg`; el resto del evento es evidencia.
    e.eventosBitacora.map((ev) => ({ nivel: 'info' as const, msg: ev.msg })),
    e.eventosEsperados,
  )));

  return filas;
}
