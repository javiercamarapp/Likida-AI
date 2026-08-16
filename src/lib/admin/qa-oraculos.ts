// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA — los oráculos de Fase A. SOLO servidor.
//
// NO se reescribe ni un oráculo: se IMPORTAN los de la Fase 1 del ejército
// (scripts/qa-agentes/oraculos/*) — el mismo código juzga la corrida del
// panel y la corrida nocturna. Este módulo solo (a) los adapta a la fila de
// tabla que pinta la pantalla y (b) fija la metadata de invariante/severidad,
// con los MISMOS valores que INVARIANTE_DE del orquestador (no se puede
// importar de ahí: orquestador.qa.ts es un archivo de vitest).
//
// dedup_comprobante (#3) y huerfano_post_cierre (#4) quedan importados y
// listos, pero los dos escenarios de Fase A no los disparan (necesitan la
// siembra especial de sus ataques — Fase B): correrlos aquí y reportar "ok"
// sobre un escenario que no los ejercita sería un veredicto inventado.
// ═══════════════════════════════════════════════════════════════════════════

import { oraculoCuadreBalancea } from '../../../scripts/qa-agentes/oraculos/cuadre_balancea.oraculo';
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

export interface EntradaOraculosFaseA {
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
}

/** Corre los 3 oráculos que los escenarios de Fase A disparan (#1, #5, #8) y
 *  devuelve las filas para el veredicto. Funciones puras sobre la DB — el LLM
 *  explora, el código juzga. */
export async function correrOraculosFaseA(e: EntradaOraculosFaseA): Promise<FilaVeredicto[]> {
  const filas: FilaVeredicto[] = [];

  filas.push(filaDesdeVeredicto(
    await oraculoCuadreBalancea(e.tenantId, e.viajeId, { esperaLiquidacion: true }),
  ));

  const respaldo = respaldoDesdeFuentes(e.fuentesRespaldo);
  filas.push(filaDesdeVeredicto(oraculoCifrasConFuente(e.textosBot, respaldo)));

  filas.push(filaDesdeVeredicto(oraculoBitacoraRegistro(
    // El oráculo solo mira `msg`; el resto del evento es evidencia.
    e.eventosBitacora.map((ev) => ({ nivel: 'info' as const, msg: ev.msg })),
    e.eventosEsperados,
  )));

  return filas;
}
