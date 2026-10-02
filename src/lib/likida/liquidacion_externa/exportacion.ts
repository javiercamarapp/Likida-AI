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

import {
  leerOpcionesFormato, leerColumnas, fechaDia, fechaInstante, tablaConfigurable,
  type OpcionesFormato, type FormatoFecha, type Separador,
} from '../export_configurable';
import { motivoDeFallo } from './api';
import type { LiquidacionExterna } from './repo';
import type { ConceptoExterno } from './esquema';

export type { FormatoFecha, Separador };
export type Granularidad = 'liquidacion' | 'concepto';

export interface OpcionesExportacion extends OpcionesFormato {
  granularidad: Granularidad;
  columnas: string[];
}

interface Contexto { o: OpcionesExportacion; concepto: ConceptoExterno | null }
type Columna = { soloEn?: 'concepto'; valor: (l: LiquidacionExterna, c: Contexto) => string | number | null };

/** El catálogo CERRADO de columnas. Una columna que no está aquí no se exporta. */
export const CATALOGO_COLUMNAS: Record<string, Columna> = {
  id: { valor: (l) => l.id },
  claveExterna: { valor: (l) => l.claveExterna },
  sistemaOrigen: { valor: (l) => l.sistemaOrigen },
  operador: { valor: (l) => l.operadorNombre },
  viajes: { valor: (l) => l.foliosViaje.join(' | ') },
  periodoDesde: { valor: (l, c) => fechaDia(l.periodoDesde, c.o.fechas) },
  periodoHasta: { valor: (l, c) => fechaDia(l.periodoHasta, c.o.fechas) },
  total: { valor: (l) => l.total },
  moneda: { valor: (l) => l.moneda },
  conceptos: { valor: (l) => String(l.conceptos.length) },
  estado: { valor: (l) => l.estado },
  via: { valor: (l) => l.via },
  respuestaChofer: { valor: (l) => (l.acuseTipo === 'no_coincide' ? 'no coincide' : l.acuseTipo) },
  respuestaEn: { valor: (l, c) => fechaInstante(l.acuseEn, c.o.fechas) },
  acuseConfirmadoEn: { valor: (l, c) => fechaInstante(l.acuseConfirmadoEn, c.o.fechas) },
  enviadaEn: { valor: (l, c) => fechaInstante(l.enviadaEn, c.o.fechas) },
  cargadaEn: { valor: (l, c) => fechaInstante(l.creadaEn, c.o.fechas) },
  falloCodigo: { valor: (l) => motivoDeFallo(l.ultimoError)?.codigo ?? null },
  // Solo con granularidad `concepto`:
  conceptoClave: { soloEn: 'concepto', valor: (_l, c) => c.concepto?.clave ?? null },
  conceptoDescripcion: { soloEn: 'concepto', valor: (_l, c) => c.concepto?.descripcion ?? null },
  conceptoTipo: { soloEn: 'concepto', valor: (_l, c) => c.concepto?.tipo ?? null },
  conceptoMonto: { soloEn: 'concepto', valor: (_l, c) => c.concepto?.monto ?? null },
  /** Percepciones en positivo y deducciones en negativo: lo que un asiento suma. */
  conceptoMontoFirmado: { soloEn: 'concepto', valor: (_l, c) => (c.concepto ? (c.concepto.tipo === 'deduccion' ? -c.concepto.monto : c.concepto.monto) : null) },
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

export type LecturaOpciones = { ok: true; opciones: OpcionesExportacion } | { ok: false; mensaje: string };

/** Lee y VALIDA los parámetros. Lo desconocido se rechaza diciendo qué aceptar. */
export function leerOpcionesExportacion(q: URLSearchParams): LecturaOpciones {
  const gran = q.get('granularidad') ?? 'liquidacion';
  if (gran !== 'liquidacion' && gran !== 'concepto') return { ok: false, mensaje: '`granularidad` tiene que ser `liquidacion` o `concepto`.' };
  const fmt = leerOpcionesFormato(q);
  if (!fmt.ok) return fmt;
  const cols = leerColumnas(q, CATALOGO_COLUMNAS, COLUMNAS_POR_DEFECTO[gran], gran);
  if (!cols.ok) return cols;
  return { ok: true, opciones: { ...fmt.opciones, granularidad: gran, columnas: cols.columnas } };
}

/** Los renglones de una liquidación según la granularidad. */
function expandir(l: LiquidacionExterna, o: OpcionesExportacion): Contexto[] {
  if (o.granularidad === 'liquidacion') return [{ o, concepto: null }];
  return l.conceptos.map((c) => ({ o, concepto: c }));
}

export function generarExportacion(filas: readonly LiquidacionExterna[], o: OpcionesExportacion): string {
  const out: Array<Array<string | number | null>> = [];
  for (const l of filas) for (const ctx of expandir(l, o)) out.push(o.columnas.map((c) => CATALOGO_COLUMNAS[c].valor(l, ctx)));
  return tablaConfigurable(o.columnas, out, o);
}
