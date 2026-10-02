// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — exportación CONFIGURABLE hacia el SAP/TMS del cliente.
//
// El cliente calculó la liquidación en su sistema; Likida la entregó y el chofer
// contestó. Lo que su contabilidad necesita es lo contrario del alta: bajar a SU
// sistema qué se entregó, qué contestó cada chofer y cuáles disputas (`No
// coincide`) hay. Cada ERP quiere su forma, así que el archivo se arma por
// parámetros en vez de un layout fijo:
//
//   · `columnas`      — cuáles y en qué orden (catálogo cerrado de abajo);
//   · `granularidad`  — `liquidacion` (una fila por liquidación) o `concepto`
//                       (una fila por renglón: lo que un asiento contable espera);
//   · `separador`     — `coma`, `punto_y_coma` o `tab`;
//   · `decimal`       — `punto` o `coma` (la coma exige separador distinto de coma);
//   · `fechas`        — `iso` (AAAA-MM-DD), `dmy` (DD/MM/AAAA) o `sap` (AAAAMMDD);
//   · `bom`           — antepone la marca UTF-8 para que Excel abra los acentos.
//
// SEGURIDAD (igual que `csv.ts`, y por lo mismo): TODO el texto viene de un
// sistema ajeno y el archivo lo abre Excel — una celda que empieza con `=`, `+`,
// `-`, `@`, tabulador o retorno se neutraliza con `'`; las CIFRAS no se tocan. El
// `ultimo_error` crudo NUNCA sale (puede traer el cuerpo de un error de Meta): se
// exporta el código estable `falloCodigo`.
// ═══════════════════════════════════════════════════════════════════════════

import { fechaIsoMx } from '../export';
import { motivoDeFallo } from './api';
import type { LiquidacionExterna } from './repo';
import type { ConceptoExterno } from './esquema';

export type Granularidad = 'liquidacion' | 'concepto';
export type Separador = 'coma' | 'punto_y_coma' | 'tab';
export type FormatoFecha = 'iso' | 'dmy' | 'sap';

export interface OpcionesExportacion {
  granularidad: Granularidad;
  columnas: string[];
  separador: Separador;
  decimal: 'punto' | 'coma';
  fechas: FormatoFecha;
  bom: boolean;
  encabezado: boolean;
}

interface Contexto { o: OpcionesExportacion; concepto: ConceptoExterno | null }
type Columna = { alcance: 'liquidacion' | 'concepto'; valor: (l: LiquidacionExterna, c: Contexto) => string | number | null };

const SEP: Record<Separador, string> = { coma: ',', punto_y_coma: ';', tab: '\t' };

/** Una fecha de calendario `AAAA-MM-DD` en el formato pedido. */
function fechaDia(iso: string | null, f: FormatoFecha): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return f === 'dmy' ? `${m[3]}/${m[2]}/${m[1]}` : f === 'sap' ? `${m[1]}${m[2]}${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`;
}
/** Un instante, expresado en el día de México (el que ve la oficina). */
const fechaInstante = (iso: string | null, f: FormatoFecha) => fechaDia(fechaIsoMx(iso) || null, f);

/** El catálogo CERRADO de columnas. Una columna que no está aquí no se exporta. */
export const CATALOGO_COLUMNAS: Record<string, Columna> = {
  id: { alcance: 'liquidacion', valor: (l) => l.id },
  claveExterna: { alcance: 'liquidacion', valor: (l) => l.claveExterna },
  sistemaOrigen: { alcance: 'liquidacion', valor: (l) => l.sistemaOrigen },
  operador: { alcance: 'liquidacion', valor: (l) => l.operadorNombre },
  viajes: { alcance: 'liquidacion', valor: (l) => l.foliosViaje.join(' | ') },
  periodoDesde: { alcance: 'liquidacion', valor: (l, c) => fechaDia(l.periodoDesde, c.o.fechas) },
  periodoHasta: { alcance: 'liquidacion', valor: (l, c) => fechaDia(l.periodoHasta, c.o.fechas) },
  total: { alcance: 'liquidacion', valor: (l) => l.total },
  moneda: { alcance: 'liquidacion', valor: (l) => l.moneda },
  conceptos: { alcance: 'liquidacion', valor: (l) => String(l.conceptos.length) },
  estado: { alcance: 'liquidacion', valor: (l) => l.estado },
  via: { alcance: 'liquidacion', valor: (l) => l.via },
  respuestaChofer: { alcance: 'liquidacion', valor: (l) => (l.acuseTipo === 'no_coincide' ? 'no coincide' : l.acuseTipo) },
  respuestaEn: { alcance: 'liquidacion', valor: (l, c) => fechaInstante(l.acuseEn, c.o.fechas) },
  acuseConfirmadoEn: { alcance: 'liquidacion', valor: (l, c) => fechaInstante(l.acuseConfirmadoEn, c.o.fechas) },
  enviadaEn: { alcance: 'liquidacion', valor: (l, c) => fechaInstante(l.enviadaEn, c.o.fechas) },
  cargadaEn: { alcance: 'liquidacion', valor: (l, c) => fechaInstante(l.creadaEn, c.o.fechas) },
  falloCodigo: { alcance: 'liquidacion', valor: (l) => motivoDeFallo(l.ultimoError)?.codigo ?? null },
  // Solo con granularidad `concepto`:
  conceptoClave: { alcance: 'concepto', valor: (_l, c) => c.concepto?.clave ?? null },
  conceptoDescripcion: { alcance: 'concepto', valor: (_l, c) => c.concepto?.descripcion ?? null },
  conceptoTipo: { alcance: 'concepto', valor: (_l, c) => c.concepto?.tipo ?? null },
  conceptoMonto: { alcance: 'concepto', valor: (_l, c) => c.concepto?.monto ?? null },
  /** Percepciones en positivo y deducciones en negativo: lo que un asiento suma. */
  conceptoMontoFirmado: { alcance: 'concepto', valor: (_l, c) => (c.concepto ? (c.concepto.tipo === 'deduccion' ? -c.concepto.monto : c.concepto.monto) : null) },
};

export const COLUMNAS_POR_DEFECTO: Record<Granularidad, string[]> = {
  liquidacion: [
    'claveExterna', 'sistemaOrigen', 'operador', 'viajes', 'periodoDesde', 'periodoHasta', 'total', 'moneda',
    'conceptos', 'estado', 'via', 'respuestaChofer', 'respuestaEn', 'acuseConfirmadoEn', 'enviadaEn', 'cargadaEn', 'falloCodigo',
  ],
  concepto: [
    'claveExterna', 'operador', 'periodoDesde', 'periodoHasta', 'moneda',
    'conceptoClave', 'conceptoDescripcion', 'conceptoTipo', 'conceptoMonto', 'conceptoMontoFirmado', 'respuestaChofer',
  ],
};

export const MAX_COLUMNAS = 30;

export type LecturaOpciones = { ok: true; opciones: OpcionesExportacion } | { ok: false; mensaje: string };

/** Lee y VALIDA los parámetros. Lo desconocido se rechaza diciendo qué aceptar. */
export function leerOpcionesExportacion(q: URLSearchParams): LecturaOpciones {
  const gran = q.get('granularidad') ?? 'liquidacion';
  if (gran !== 'liquidacion' && gran !== 'concepto') return { ok: false, mensaje: '`granularidad` tiene que ser `liquidacion` o `concepto`.' };
  const separador = q.get('separador') ?? 'coma';
  if (!(separador in SEP)) return { ok: false, mensaje: '`separador` tiene que ser `coma`, `punto_y_coma` o `tab`.' };
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
  const crudas = q.get('columnas');
  const columnas = crudas ? crudas.split(',').map((c) => c.trim()).filter(Boolean) : COLUMNAS_POR_DEFECTO[gran];
  if (columnas.length === 0 || columnas.length > MAX_COLUMNAS) return { ok: false, mensaje: `\`columnas\` lleva entre 1 y ${MAX_COLUMNAS} nombres.` };
  if (new Set(columnas).size !== columnas.length) return { ok: false, mensaje: '`columnas` no puede repetir un nombre.' };
  for (const c of columnas) {
    const def = Object.hasOwn(CATALOGO_COLUMNAS, c) ? CATALOGO_COLUMNAS[c] : undefined;
    if (!def) return { ok: false, mensaje: `\`columnas\`: «${c.slice(0, 40)}» no existe. Opciones: ${Object.keys(CATALOGO_COLUMNAS).join(', ')}.` };
    if (def.alcance === 'concepto' && gran !== 'concepto') {
      return { ok: false, mensaje: `\`columnas\`: «${c}» solo existe con \`granularidad=concepto\` (una fila por renglón).` };
    }
  }
  return { ok: true, opciones: { granularidad: gran, columnas, separador: separador as Separador, decimal, fechas, bom: q.get('bom') === '1', encabezado: q.get('encabezado') !== '0' } };
}

function celdaTexto(v: string, sep: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function celda(v: string | number | null, o: OpcionesExportacion): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    // Cifras con dos decimales SIEMPRE (importes). Los conteos (`conceptos`) salen enteros.
    const t = v.toFixed(2);
    return o.decimal === 'coma' ? t.replace('.', ',') : t;
  }
  return celdaTexto(v, SEP[o.separador]);
}

/** Los renglones de una liquidación según la granularidad (sin conceptos → 1 fila vacía de renglón). */
function expandir(l: LiquidacionExterna, o: OpcionesExportacion): Contexto[] {
  if (o.granularidad === 'liquidacion') return [{ o, concepto: null }];
  return l.conceptos.map((c) => ({ o, concepto: c }));
}

export function generarExportacion(filas: readonly LiquidacionExterna[], o: OpcionesExportacion): string {
  const sep = SEP[o.separador];
  const lineas: string[] = [];
  if (o.encabezado) lineas.push(o.columnas.map((c) => celdaTexto(c, sep)).join(sep));
  for (const l of filas) {
    for (const ctx of expandir(l, o)) {
      lineas.push(o.columnas.map((c) => celda(CATALOGO_COLUMNAS[c].valor(l, ctx), o)).join(sep));
    }
  }
  return `${o.bom ? '﻿' : ''}${lineas.join('\n')}${lineas.length ? '\n' : ''}`;
}
