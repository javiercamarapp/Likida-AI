// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA CONCILIADA HACIA EL SAP/ERP DEL CLIENTE — exportación CONFIGURABLE.
//
// El CSV fijo de `bitacora_conciliada.ts` (con su leyenda adentro) es para el
// contralor que lo abre en Excel. Un SAP/ERP quiere OTRO layout: sus columnas,
// su separador, su coma decimal y sus fechas, y sin renglones de comentario. Este
// módulo lo arma por parámetros (ver `export_configurable.ts`) a partir de las
// MISMAS filas conciliadas, así que el estado de cada línea es el mismo en las dos
// salidas.
//
// LA DOCTRINA SE QUEDA: cada fila lleva `estado` (cuadra / sin respaldo / por
// verificar), `motivo` y `explicacion`; «sin respaldo» es un hecho sobre los datos
// de Likida, no una acusación. Por eso `estado`, `motivo` y `explicacion` están en
// el layout por defecto y la leyenda de la bitácora viaja en el encabezado HTTP
// `X-Likida-Leyenda`.
// ═══════════════════════════════════════════════════════════════════════════

import {
  leerOpcionesFormato, leerColumnas, fechaDia, tablaConfigurable, type OpcionesFormato,
} from '../export_configurable';
import { ETIQUETA_ESTADO, type BitacoraConciliada, type FilaConciliada } from './bitacora_conciliada';

export interface OpcionesExportacionPeajes extends OpcionesFormato { columnas: string[] }

interface Ctx { b: BitacoraConciliada; o: OpcionesExportacionPeajes }
type Columna = { soloEn?: string; valor: (f: FilaConciliada, c: Ctx) => string | number | null };

/** El catálogo CERRADO de columnas. */
export const CATALOGO_COLUMNAS_PEAJES: Record<string, Columna> = {
  desglose: { valor: (_f, c) => c.b.desgloseId },
  proveedor: { valor: (_f, c) => c.b.proveedor },
  linea: { valor: (f) => String(f.indice + 1) },
  fechaCruce: { valor: (f, c) => fechaDia(f.fecha, c.o.fechas) },
  horaCruce: { valor: (f) => f.hora || null },
  casetaProveedor: { valor: (f) => f.casetaProveedor || null },
  casetaCatalogo: { valor: (f) => f.casetaCatalogo || null },
  tag: { valor: (f) => f.tag || null },
  unidadTag: { valor: (f) => f.unidad || null },
  monto: { valor: (f) => f.monto },
  estado: { valor: (f) => ETIQUETA_ESTADO[f.estado] },
  motivo: { valor: (f) => f.motivo },
  explicacion: { valor: (f) => f.explicacion },
  viaje: { valor: (f) => f.viaje || null },
  diferenciaMxn: { valor: (f) => f.diferencia },
  gps: { valor: (f) => f.gps },
  gpsDistanciaM: { valor: (f) => f.gpsDistanciaM },
  gpsNota: { valor: (f) => f.gpsNota || null },
};

export const COLUMNAS_POR_DEFECTO_PEAJES: readonly string[] = [
  'linea', 'fechaCruce', 'horaCruce', 'casetaProveedor', 'casetaCatalogo', 'tag', 'unidadTag', 'monto', 'estado', 'motivo',
  'explicacion', 'viaje', 'diferenciaMxn', 'gps', 'gpsDistanciaM', 'gpsNota',
];

export type LecturaOpcionesPeajes = { ok: true; opciones: OpcionesExportacionPeajes } | { ok: false; mensaje: string };

export function leerOpcionesExportacionPeajes(q: URLSearchParams): LecturaOpcionesPeajes {
  const fmt = leerOpcionesFormato(q);
  if (!fmt.ok) return fmt;
  const cols = leerColumnas(q, CATALOGO_COLUMNAS_PEAJES, COLUMNAS_POR_DEFECTO_PEAJES);
  if (!cols.ok) return cols;
  return { ok: true, opciones: { ...fmt.opciones, columnas: cols.columnas } };
}

export function generarExportacionPeajes(b: BitacoraConciliada, o: OpcionesExportacionPeajes): string {
  const filas = b.filas.map((f) => o.columnas.map((c) => CATALOGO_COLUMNAS_PEAJES[c].valor(f, { b, o })));
  return tablaConfigurable(o.columnas, filas, o);
}
