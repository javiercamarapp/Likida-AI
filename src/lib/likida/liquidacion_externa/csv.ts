// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — exportación CSV (lo que la oficina cruza contra su SAP).
//
// DOS DIFERENCIAS CON `toCsv` DE `lib/likida/export.ts`, y las dos son de
// seguridad: aquí TODO el texto viene de un sistema ajeno (nombres de concepto,
// claves, folios) y el archivo lo abre Excel.
//
//   1. INYECCIÓN DE FÓRMULAS. Una celda que empieza con `=`, `+`, `-`, `@`,
//      tabulador o retorno de carro la evalúa Excel como fórmula
//      (`=HYPERLINK(...)`, `=cmd|...`). Se neutraliza anteponiendo `'`. Las
//      CIFRAS no se tocan: un total negativo legítimo («-350.00») tiene que
//      seguir siendo número.
//   2. Cada fila lleva SU moneda: un CSV con MXN y USD mezclados sin columna de
//      moneda se suma mal sin que nada avise.
// ═══════════════════════════════════════════════════════════════════════════

import { fechaIsoMx } from '../export';
import type { LiquidacionExterna } from './repo';

/** Texto → celda segura: sin fórmulas, con comillas escapadas. */
export function celdaTexto(v: string | null | undefined): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Número → celda. Solo números finitos; cualquier otra cosa sale vacía. */
export function celdaNumero(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '';
}

export const ENCABEZADOS_CSV = [
  'claveExterna', 'sistemaOrigen', 'operador', 'viajes', 'periodoDesde', 'periodoHasta',
  'total', 'moneda', 'conceptos', 'estado', 'via', 'respuestaChofer', 'respuestaEn',
  'enviadaEn', 'cargadaEn', 'ultimoError',
] as const;

const ETIQUETA_ACUSE: Record<string, string> = { recibida: 'recibida', no_coincide: 'no coincide' };

export function filaCsv(l: LiquidacionExterna): string {
  return [
    celdaTexto(l.claveExterna),
    celdaTexto(l.sistemaOrigen),
    celdaTexto(l.operadorNombre),
    celdaTexto(l.foliosViaje.join(' | ')),
    celdaTexto(l.periodoDesde),
    celdaTexto(l.periodoHasta),
    celdaNumero(l.total),
    celdaTexto(l.moneda),
    String(l.conceptos.length),
    celdaTexto(l.estado),
    celdaTexto(l.via),
    celdaTexto(l.acuseTipo ? ETIQUETA_ACUSE[l.acuseTipo] : ''),
    celdaTexto(fechaIsoMx(l.acuseEn)),
    celdaTexto(fechaIsoMx(l.enviadaEn)),
    celdaTexto(fechaIsoMx(l.creadaEn)),
    celdaTexto(l.ultimoError),
  ].join(',');
}

export function csvLiquidacionesExternas(filas: LiquidacionExterna[]): string {
  return `${ENCABEZADOS_CSV.join(',')}\n${filas.map(filaCsv).join('\n')}${filas.length ? '\n' : ''}`;
}
