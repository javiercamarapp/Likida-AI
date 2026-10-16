// ═══════════════════════════════════════════════════════════════════════════
// REVISIÓN HUMANA POR FORMATO — qué se resalta al lado del documento (T-A3-63). PURO.
//
// Toda conversión pasa por una persona. En la pantalla de revisión (documento a la izquierda, lo leído a la derecha) hay dos
// clases de valor que la persona debe mirar con más cuidado y que se RESALTAN:
//   · INFERIDOS: no salieron del documento (los completó el catálogo del cliente o el agente los calculó). Nunca se presentan
//     como «leídos»: llevan su rótulo y su origen en llano.
//   · POCO SEGUROS: salieron del documento, pero el agente no está seguro de haberlos leído bien (confianza < umbral).
//
// El aprendizaje del formato aprobado NO vive aquí: lo hace `bandeja.aprobarDocumento` con `perfiles.aprender` (la persona
// aprueba con o sin correcciones ⇒ versión siguiente del perfil; un rechazo no aprende nada). Este archivo solo decide qué
// se marca y cómo se le dice a la persona, sin tocar base ni red.
// ═══════════════════════════════════════════════════════════════════════════

import type { Origen } from './campos';
import type { FilaCampo, Revision } from './presentacion';

/** Debajo de esto el valor se resalta como «poco seguro». Coincide con el verde/ámbar de la pantalla (≥ 0.8 no es rojo). */
export const UMBRAL_BAJA_CONFIANZA = 0.8;

/** Orígenes que significan «no salió del documento»: el catálogo del cliente o un cálculo. */
export const ORIGENES_INFERIDOS: readonly Origen[] = ['catalogo', 'derivado'];

const MAX_LINEAS_ORIGINAL = 600;
const MIN_EVIDENCIA = 4;

export interface MarcaRevision {
  inferido: boolean;
  bajaConfianza: boolean;
  /** Frases en llano para la persona (vacío = nada que resaltar). */
  avisos: string[];
}

const AVISO_INFERIDO: Partial<Record<Origen, string>> = {
  catalogo: 'Inferido del catálogo del cliente: el documento no lo trae. Confírmalo o corrígelo.',
  derivado: 'Calculado por el agente: el documento no lo trae. Confírmalo o corrígelo.',
};

export function marcaDeFila(f: Pick<FilaCampo, 'origen' | 'confianza' | 'valor'>): MarcaRevision {
  const tieneValor = f.valor.trim() !== '';
  const inferido = tieneValor && f.origen !== null && ORIGENES_INFERIDOS.includes(f.origen);
  const bajaConfianza = tieneValor && f.confianza !== null && f.confianza < UMBRAL_BAJA_CONFIANZA;
  const avisos: string[] = [];
  if (inferido && f.origen) avisos.push(AVISO_INFERIDO[f.origen] ?? 'Inferido: el documento no lo trae.');
  if (bajaConfianza) avisos.push('Poco seguro: revísalo contra el documento.');
  return { inferido, bajaConfianza, avisos };
}

function filasDe(r: Revision): FilaCampo[] {
  return [...r.grupos.flatMap((g) => g.filas), ...r.mercancias.filter((m) => !m.esNuevo).flatMap((m) => m.filas)];
}

export interface ResumenMarcas { inferidos: number; pocoSeguros: number }

export function resumenDeMarcas(r: Revision): ResumenMarcas {
  let inferidos = 0;
  let pocoSeguros = 0;
  for (const f of filasDe(r)) {
    const m = marcaDeFila(f);
    if (m.inferido) inferidos += 1;
    if (m.bajaConfianza) pocoSeguros += 1;
  }
  return { inferidos, pocoSeguros };
}

export interface LineaOriginal { texto: string; resaltada: boolean }

/**
 * El texto del documento original por líneas; se resaltan las líneas donde el agente dice haber leído un valor que hay que
 * mirar (poco seguro, por confirmar o por corregir). Un inferido no tiene línea: no salió del documento.
 */
export function lineasDelOriginal(texto: string, r: Revision | null): { lineas: LineaOriginal[]; recortado: boolean } {
  const todas = texto.split(/\r?\n/);
  const recortado = todas.length > MAX_LINEAS_ORIGINAL;
  const base = recortado ? todas.slice(0, MAX_LINEAS_ORIGINAL) : todas;
  const evidencias = r === null ? [] : filasDe(r)
    .filter((f) => f.evidencia && f.evidencia.trim().length >= MIN_EVIDENCIA && (marcaDeFila(f).bajaConfianza || f.porConfirmar || f.bloqueado) && !marcaDeFila(f).inferido)
    .map((f) => (f.evidencia as string).trim().toLowerCase());
  return {
    lineas: base.map((t) => ({ texto: t, resaltada: evidencias.length > 0 && evidencias.some((e) => t.toLowerCase().includes(e)) })),
    recortado,
  };
}
