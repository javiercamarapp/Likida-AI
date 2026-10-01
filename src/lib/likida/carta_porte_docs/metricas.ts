// ═══════════════════════════════════════════════════════════════════════════
// MÉTRICAS DEL AGENTE — qué tan bien lee y cuánto tiempo ahorra.
//
// Regla de la casa: ninguna cifra inventada. Cada número dice de qué se calcula
// y, cuando necesita un supuesto, lo trae a la vista:
//
//   · «% sin corrección» = documentos APROBADOS en los que nadie cambió un solo
//     valor / documentos aprobados. Confirmar un dato dudoso NO es corregirlo.
//   · «tiempo de revisión» es MEDIDO: de que alguien abre el documento a que lo
//     aprueba. Un documento sin esa marca (aprobado antes de existir la medición,
//     o por API) no cuenta para el promedio y se reporta aparte.
//   · «tiempo ahorrado por embarque» = MINUTOS_CAPTURA_MANUAL_EMBARQUE − tiempo de
//     revisión medido. El primero es un SUPUESTO declarado (no una medición) y se
//     muestra con ese rótulo; si una flota mide el suyo, se cambia aquí, en un
//     solo lugar.
// ═══════════════════════════════════════════════════════════════════════════

import type { DocumentoFila } from './repo';

/**
 * SUPUESTO, no medición: minutos que toma capturar a mano un embarque en Likida
 * (origen y destino con RFC, CP y estado, 1 a 3 mercancías con clave SAT, unidad y
 * peso, operador y placas, y cotejarlos contra el documento del cliente). Estimación
 * de diseño del 1-oct-2026; se reemplaza por una medición cuando exista un piloto.
 */
export const MINUTOS_CAPTURA_MANUAL_EMBARQUE = 12;

export interface MetricasAgente {
  /** Documentos que llegaron en el periodo. */
  recibidos: number;
  porRevisar: number;
  aprobados: number;
  rechazados: number;
  fallidos: number;
  /** `null` = no hay aprobados todavía: no se pinta un 0 % que parezca medición. */
  pctSinCorreccion: number | null;
  sinCorreccion: number;
  conCorreccion: number;
  /** Aprobados sin ninguna lectura de modelo (XML, perfil): costo cero. */
  sinModelo: number;
  /** Promedio MEDIDO de minutos de revisión, o `null` si ningún aprobado trae la marca. */
  minutosRevisionPromedio: number | null;
  aprobadosMedidos: number;
  aprobadosSinMedir: number;
  /** Minutos ahorrados (suma) sobre los aprobados MEDIDOS, y por embarque. */
  minutosAhorradosTotal: number | null;
  minutosAhorradosPorEmbarque: number | null;
  supuestoMinutosManual: number;
  costoUsdTotal: number;
  costoUsdPorDocumento: number | null;
  porOrigen: Record<string, { documentos: number; sinCorreccion: number }>;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Cómo se leyó el documento, SIN abrir la extracción (la lista liviana no la trae): sale de las columnas. */
export function origenDeLectura(d: Pick<DocumentoFila, 'nivelModelo' | 'perfilId'>): 'xml' | 'perfil' | 'perfil+llm' | 'llm' {
  if (d.nivelModelo === 0) return d.perfilId === null ? 'xml' : 'perfil';
  return d.perfilId === null ? 'llm' : 'perfil+llm';
}

export function calcularMetricas(docs: DocumentoFila[], correcciones: Map<string, number>): MetricasAgente {
  const por = (e: DocumentoFila['estado']) => docs.filter((d) => d.estado === e);
  const aprobados = por('aprobado');
  const sin = aprobados.filter((d) => (correcciones.get(d.id) ?? 0) === 0);
  const medidos = aprobados.filter((d) => d.tiempoRevisionSeg !== null);
  const minutos = medidos.map((d) => (d.tiempoRevisionSeg as number) / 60);
  const ahorros = minutos.map((m) => Math.max(0, MINUTOS_CAPTURA_MANUAL_EMBARQUE - m));
  const costo = docs.reduce((s, d) => s + d.costoUsd, 0);

  const porOrigen: MetricasAgente['porOrigen'] = {};
  for (const d of aprobados) {
    const o = origenDeLectura(d);
    porOrigen[o] ??= { documentos: 0, sinCorreccion: 0 };
    porOrigen[o].documentos++;
    if ((correcciones.get(d.id) ?? 0) === 0) porOrigen[o].sinCorreccion++;
  }

  return {
    recibidos: docs.length,
    porRevisar: por('por_revisar').length,
    aprobados: aprobados.length,
    rechazados: por('rechazado').length,
    fallidos: por('fallido').length,
    pctSinCorreccion: aprobados.length === 0 ? null : r1((sin.length / aprobados.length) * 100),
    sinCorreccion: sin.length,
    conCorreccion: aprobados.length - sin.length,
    sinModelo: aprobados.filter((d) => d.nivelModelo === null || d.nivelModelo === 0).length,
    minutosRevisionPromedio: minutos.length === 0 ? null : r1(minutos.reduce((s, m) => s + m, 0) / minutos.length),
    aprobadosMedidos: medidos.length,
    aprobadosSinMedir: aprobados.length - medidos.length,
    minutosAhorradosTotal: ahorros.length === 0 ? null : r1(ahorros.reduce((s, m) => s + m, 0)),
    minutosAhorradosPorEmbarque: ahorros.length === 0 ? null : r1(ahorros.reduce((s, m) => s + m, 0) / ahorros.length),
    supuestoMinutosManual: MINUTOS_CAPTURA_MANUAL_EMBARQUE,
    costoUsdTotal: Math.round(costo * 1e6) / 1e6,
    costoUsdPorDocumento: docs.length === 0 ? null : Math.round((costo / docs.length) * 1e6) / 1e6,
    porOrigen,
  };
}
