// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIÓN CONFIGURABLE (CSV/TSV) hacia el SAP/ERP del cliente — la parte
// COMÚN a los agentes que entregan un archivo a la contabilidad del cliente
// (liquidación externa, bitácora conciliada de peajes).
//
// El layout lo decide el cliente por parámetros de la URL:
//
//   · `separador`   — `coma`, `punto_y_coma` o `tab`;
//   · `decimal`     — `punto` o `coma` (la coma exige separador distinto de coma);
//   · `fechas`      — `iso` (AAAA-MM-DD), `dmy` (DD/MM/AAAA) o `sap` (AAAAMMDD);
//   · `bom`         — antepone la marca UTF-8 para que Excel abra los acentos;
//   · `encabezado`  — `0` quita la fila de encabezados;
//   · `columnas`    — cuáles y en qué orden, de UN catálogo cerrado por agente.
//
// SEGURIDAD: todo el texto viene de un sistema ajeno y el archivo lo abre
// Excel. Una celda que empieza con `=`, `+`, `-`, `@`, tabulador o retorno se
// neutraliza con `'`; las CIFRAS no se tocan (un importe negativo legítimo sigue
// siendo número); un texto con el separador elegido se entrecomilla.
// ═══════════════════════════════════════════════════════════════════════════

import { fechaIsoMx } from './export';

export type Separador = 'coma' | 'punto_y_coma' | 'tab';
export type FormatoFecha = 'iso' | 'dmy' | 'sap';

export interface OpcionesFormato {
  separador: Separador;
  decimal: 'punto' | 'coma';
  fechas: FormatoFecha;
  bom: boolean;
  encabezado: boolean;
}

export const SEPARADORES: Record<Separador, string> = { coma: ',', punto_y_coma: ';', tab: '\t' };
export const MAX_COLUMNAS = 30;

export type LecturaFormato = { ok: true; opciones: OpcionesFormato } | { ok: false; mensaje: string };

/** Lee y VALIDA los parámetros de formato. Lo desconocido se rechaza diciendo qué aceptar. */
export function leerOpcionesFormato(q: URLSearchParams): LecturaFormato {
  const separador = q.get('separador') ?? 'coma';
  if (!Object.hasOwn(SEPARADORES, separador)) return { ok: false, mensaje: '`separador` tiene que ser `coma`, `punto_y_coma` o `tab`.' };
  const decimal = q.get('decimal') ?? 'punto';
  if (decimal !== 'punto' && decimal !== 'coma') return { ok: false, mensaje: '`decimal` tiene que ser `punto` o `coma`.' };
  if (decimal === 'coma' && separador === 'coma') {
    return { ok: false, mensaje: 'Con `decimal=coma` el separador de columnas no puede ser `coma` (el archivo quedaría ambiguo): usa `separador=punto_y_coma` o `tab`.' };
  }
  const fechas = q.get('fechas') ?? 'iso';
  if (fechas !== 'iso' && fechas !== 'dmy' && fechas !== 'sap') return { ok: false, mensaje: '`fechas` tiene que ser `iso`, `dmy` o `sap`.' };
  for (const b of ['bom', 'encabezado'] as const) {
    const v = q.get(b);
    if (v !== null && v !== '0' && v !== '1') return { ok: false, mensaje: `\`${b}\` solo acepta 1 o 0.` };
  }
  return { ok: true, opciones: { separador: separador as Separador, decimal, fechas, bom: q.get('bom') === '1', encabezado: q.get('encabezado') !== '0' } };
}

/** Valida `columnas` contra un catálogo CERRADO (sin heredar del prototipo). `soloEn` marca las columnas que solo existen con cierta granularidad. */
export function leerColumnas(
  q: URLSearchParams, catalogo: Record<string, { soloEn?: string }>, porDefecto: readonly string[], granularidad?: string,
): { ok: true; columnas: string[] } | { ok: false; mensaje: string } {
  const crudas = q.get('columnas');
  const columnas = crudas ? crudas.split(',').map((c) => c.trim()).filter(Boolean) : [...porDefecto];
  if (columnas.length === 0 || columnas.length > MAX_COLUMNAS) return { ok: false, mensaje: `\`columnas\` lleva entre 1 y ${MAX_COLUMNAS} nombres.` };
  if (new Set(columnas).size !== columnas.length) return { ok: false, mensaje: '`columnas` no puede repetir un nombre.' };
  for (const c of columnas) {
    const def = Object.hasOwn(catalogo, c) ? catalogo[c] : undefined;
    if (!def) return { ok: false, mensaje: `\`columnas\`: «${c.slice(0, 40)}» no existe. Opciones: ${Object.keys(catalogo).join(', ')}.` };
    if (def.soloEn && def.soloEn !== granularidad) {
      return { ok: false, mensaje: `\`columnas\`: «${c}» solo existe con \`granularidad=${def.soloEn}\` (una fila por renglón).` };
    }
  }
  return { ok: true, columnas };
}

/** Una fecha de calendario `AAAA-MM-DD` en el formato pedido. */
export function fechaDia(iso: string | null | undefined, f: FormatoFecha): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return f === 'dmy' ? `${m[3]}/${m[2]}/${m[1]}` : f === 'sap' ? `${m[1]}${m[2]}${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Un instante, expresado en el día de México (el que ve la oficina). */
export const fechaInstante = (iso: string | null | undefined, f: FormatoFecha): string => fechaDia(fechaIsoMx(iso) || null, f);

export type Celda = string | number | null | undefined;

function celdaTexto(v: string, sep: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Texto neutralizado/entrecomillado; número con dos decimales y la coma elegida; nulo → vacío. */
export function celda(v: Celda, o: OpcionesFormato): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    const t = v.toFixed(2);
    return o.decimal === 'coma' ? t.replace('.', ',') : t;
  }
  return celdaTexto(v, SEPARADORES[o.separador]);
}

/** Arma el archivo: encabezados (opcional) y filas, con BOM opcional. */
export function tablaConfigurable(encabezados: readonly string[], filas: ReadonlyArray<readonly Celda[]>, o: OpcionesFormato): string {
  const sep = SEPARADORES[o.separador];
  const lineas: string[] = [];
  if (o.encabezado) lineas.push(encabezados.map((c) => celdaTexto(c, sep)).join(sep));
  for (const f of filas) lineas.push(f.map((v) => celda(v, o)).join(sep));
  return `${o.bom ? '﻿' : ''}${lineas.join('\n')}${lineas.length ? '\n' : ''}`;
}
