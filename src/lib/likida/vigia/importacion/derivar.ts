// ═══════════════════════════════════════════════════════════════════════════
// ESTATUS DE IMPORTACIÓN DERIVADO DEL PROGRAMA (T-A4-37).
//
// Lo que pidió el cliente (levantamiento 9df88631 ~16:56): el estatus de cada caja (patio / pendiente de cruce / en ruta
// y documentos listos / pendientes de requisito) lo escribe una persona a mano en el programa y «no siempre» lo tiene al
// día. Mientras no haya acceso a Track & Trace (T-A4-38), el estatus se DERIVA de las columnas TRANSITO y CCP del propio
// programa con el mapeo de `modelo.ts`; este archivo cuenta cajas por día, señala las filas incoherentes y arma el CSV
// que el equipo pega donde hoy lo escribe a mano. Nunca escribe en un sistema externo.
//
// Solo cuentan las filas de IMPORTACION: TRANSITO y CCP son el estatus de esa sección.
// Código puro: sin red, sin base de datos, sin credenciales.
// ═══════════════════════════════════════════════════════════════════════════
import { tablaConfigurable, type OpcionesFormato } from '../../export_configurable';
import type { FilaPrograma } from '../programa/normalizar';
import {
  compararProgramaConTrackTrace, docsDesdeCcp, estadoDesdeTransito,
  type DocsImportacion, type EstadoImportacion, type EstatusImportacion,
} from './modelo';

/** Rótulo obligatorio de la pantalla y del CSV: lo derivado no se presenta como verificado. */
export const ROTULO_DERIVADO = 'Derivado del programa, no verificado contra Track & Trace.';

export type FilaImportacion = Pick<FilaPrograma, 'lineaCsv' | 'fecha' | 'tipo' | 'caja' | 'unidad' | 'transito' | 'ccp'>;

export type CodigoIncoherencia = 'listo_sin_transito' | 'en_ruta_sin_documentos';

export const MENSAJE_INCOHERENCIA: Record<CodigoIncoherencia, string> = {
  listo_sin_transito: 'Los documentos están en «LISTO» pero la columna TRANSITO está vacía: no se sabe dónde está la caja.',
  en_ruta_sin_documentos: 'La caja va «EN RUTA» pero los documentos siguen pendientes de requisito.',
};

export const ETIQUETA_ESTADO: Record<EstadoImportacion, string> = {
  patio: 'En patio', pend_cruce: 'Pendiente de cruce', en_ruta: 'En ruta', desconocido: 'Sin estatus',
};
export const ETIQUETA_DOCS: Record<DocsImportacion, string> = {
  listo: 'Documentos listos', pend_requisito: 'Pendiente de requisito', desconocido: 'Sin estatus',
};

export interface Incoherencia {
  lineaCsv: number;
  fecha: string;
  caja: string | null;
  unidad: string | null;
  codigo: CodigoIncoherencia;
  mensaje: string;
}

export interface CajaDerivada {
  fecha: string;
  caja: string;
  unidad: string | null;
  estado: EstadoImportacion;
  docs: DocsImportacion;
  /** Códigos de incoherencia de alguna fila de esa caja ese día. */
  incoherencias: CodigoIncoherencia[];
}

export interface DiaImportacion {
  fecha: string;
  /** Cajas distintas ese día (una caja repetida en varias filas cuenta una vez). */
  cajas: number;
  /** Filas de importación sin caja: no se pueden contar como caja. */
  sinCaja: number;
  porEstado: Record<EstadoImportacion, number>;
  porDocs: Record<DocsImportacion, number>;
}

export interface ComparacionTT {
  /** Cajas del programa que Track & Trace también reporta. */
  comparadas: number;
  coinciden: number;
  /** Cajas donde ambos saben algo y no dicen lo mismo. */
  difieren: string[];
  /** Cajas del programa de las que Track & Trace no dice nada. */
  sinDatoTT: number;
}

export interface EstatusDerivado {
  dias: DiaImportacion[];
  /** Una por caja y día, ordenadas por fecha y caja. */
  cajas: CajaDerivada[];
  incoherencias: Incoherencia[];
  filasImportacion: number;
  /** Filas de otras secciones (exportación, vacíos…), que no cuentan aquí. */
  filasOtrasSecciones: number;
  /** Filas de importación sin fecha de sección: no se pueden ubicar en un día. */
  sinFecha: number;
  /** `null` mientras no haya datos de Track & Trace con qué comparar. */
  comparacion: ComparacionTT | null;
}

export interface OpcionesDerivar {
  /** Lo que dice Track & Trace, cuando exista (T-A4-38). */
  trackTrace?: readonly EstatusImportacion[];
  /** Instante de la derivación, ISO con zona (para comparar con T&T). */
  observadoEn?: string;
}

const vacioEstados = (): Record<EstadoImportacion, number> => ({ patio: 0, pend_cruce: 0, en_ruta: 0, desconocido: 0 });
const vacioDocs = (): Record<DocsImportacion, number> => ({ listo: 0, pend_requisito: 0, desconocido: 0 });

const claveCaja = (c: string): string => c.trim().toLowerCase();

function incoherenciasDeFila(f: FilaImportacion): CodigoIncoherencia[] {
  const out: CodigoIncoherencia[] = [];
  const estado = estadoDesdeTransito(f.transito);
  const docs = docsDesdeCcp(f.ccp);
  if (docs === 'listo' && f.transito === 'vacio') out.push('listo_sin_transito');
  if (estado === 'en_ruta' && docs === 'pend_requisito') out.push('en_ruta_sin_documentos');
  return out;
}

/**
 * Estatus de importación de cada caja a partir de las filas ya normalizadas del programa. Por caja y día, si hay
 * varias filas, vale el primer dato que no sea «sin estatus». No inventa: un TRANSITO o CCP que no se entiende cuenta
 * como «sin estatus».
 */
export function derivarEstatusImportacion(
  filas: readonly FilaImportacion[],
  opciones: OpcionesDerivar = {},
): EstatusDerivado {
  const porCaja = new Map<string, CajaDerivada>();
  const sinCajaPorDia = new Map<string, number>();
  const incoherencias: Incoherencia[] = [];
  let filasImportacion = 0;
  let filasOtrasSecciones = 0;
  let sinFecha = 0;

  for (const f of filas) {
    if (f.tipo !== 'IMPORTACION') { filasOtrasSecciones++; continue; }
    filasImportacion++;
    if (f.fecha === null) { sinFecha++; continue; }

    const cods = incoherenciasDeFila(f);
    for (const codigo of cods) {
      incoherencias.push({ lineaCsv: f.lineaCsv, fecha: f.fecha, caja: f.caja, unidad: f.unidad, codigo, mensaje: MENSAJE_INCOHERENCIA[codigo] });
    }

    if (f.caja === null || f.caja.trim() === '') {
      sinCajaPorDia.set(f.fecha, (sinCajaPorDia.get(f.fecha) ?? 0) + 1);
      continue;
    }
    const estado = estadoDesdeTransito(f.transito);
    const docs = docsDesdeCcp(f.ccp);
    const k = `${f.fecha}|${claveCaja(f.caja)}`;
    const previa = porCaja.get(k);
    if (!previa) {
      porCaja.set(k, { fecha: f.fecha, caja: f.caja.trim(), unidad: f.unidad, estado, docs, incoherencias: [...cods] });
      continue;
    }
    if (previa.estado === 'desconocido') previa.estado = estado;
    if (previa.docs === 'desconocido') previa.docs = docs;
    if (previa.unidad === null) previa.unidad = f.unidad;
    for (const c of cods) if (!previa.incoherencias.includes(c)) previa.incoherencias.push(c);
  }

  const cajas = [...porCaja.values()].sort((a, b) => (a.fecha === b.fecha ? (a.caja < b.caja ? -1 : a.caja > b.caja ? 1 : 0) : a.fecha < b.fecha ? -1 : 1));

  const porDia = new Map<string, DiaImportacion>();
  const dia = (fecha: string): DiaImportacion => {
    let d = porDia.get(fecha);
    if (!d) { d = { fecha, cajas: 0, sinCaja: 0, porEstado: vacioEstados(), porDocs: vacioDocs() }; porDia.set(fecha, d); }
    return d;
  };
  for (const c of cajas) {
    const d = dia(c.fecha);
    d.cajas++; d.porEstado[c.estado]++; d.porDocs[c.docs]++;
  }
  for (const [fecha, n] of sinCajaPorDia) dia(fecha).sinCaja = n;

  incoherencias.sort((a, b) => (a.fecha === b.fecha ? a.lineaCsv - b.lineaCsv : a.fecha < b.fecha ? -1 : 1));

  return {
    dias: [...porDia.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)),
    cajas, incoherencias, filasImportacion, filasOtrasSecciones, sinFecha,
    comparacion: opciones.trackTrace && opciones.trackTrace.length > 0
      ? compararConTrackTrace(cajas, opciones.trackTrace, opciones.observadoEn ?? new Date(0).toISOString())
      : null,
  };
}

function compararConTrackTrace(
  cajas: readonly CajaDerivada[],
  trackTrace: readonly EstatusImportacion[],
  observadoEn: string,
): ComparacionTT {
  const tt = new Map<string, EstatusImportacion>();
  for (const r of trackTrace) if (r.fuente === 'track_trace') tt.set(claveCaja(r.caja), r);
  // El programa dice una cosa por caja y día; para comparar se toma la fila más reciente de cada caja.
  const reciente = new Map<string, CajaDerivada>();
  for (const c of cajas) {
    const k = claveCaja(c.caja);
    const p = reciente.get(k);
    if (!p || c.fecha >= p.fecha) reciente.set(k, c);
  }
  let comparadas = 0; let coinciden = 0; let sinDatoTT = 0;
  const difieren: string[] = [];
  for (const [k, c] of reciente) {
    const t = tt.get(k);
    if (!t) { sinDatoTT++; continue; }
    const programa: EstatusImportacion = {
      caja: c.caja, unidad: c.unidad, estado: c.estado, docs: c.docs, fuente: 'programa', observadoEn, filaId: null,
    };
    const r = compararProgramaConTrackTrace(programa, t);
    if (r === 'sin_comparar') { sinDatoTT++; continue; }
    comparadas++;
    if (r === 'coinciden') coinciden++; else difieren.push(c.caja);
  }
  return { comparadas, coinciden, difieren: difieren.sort(), sinDatoTT };
}

const FORMATO_CSV: OpcionesFormato = { separador: 'coma', decimal: 'punto', fechas: 'iso', bom: true, encabezado: true };

const ENCABEZADOS_CSV = ['Fecha', 'Caja', 'Unidad', 'Estatus de la caja', 'Documentos', 'Revisar', 'Fuente'] as const;

/**
 * CSV del estatus por caja para que el equipo lo pegue donde hoy lo escribe a mano. Toda celda de texto pasa por la
 * neutralización de fórmulas de `export_configurable` (una caja «=2+2» sale como texto). La última columna lleva el
 * rótulo de que es un dato derivado.
 */
export function estatusACsv(cajas: readonly CajaDerivada[]): string {
  const filas = cajas.map((c) => [
    c.fecha, c.caja, c.unidad, ETIQUETA_ESTADO[c.estado], ETIQUETA_DOCS[c.docs],
    c.incoherencias.map((i) => MENSAJE_INCOHERENCIA[i]).join(' '),
    ROTULO_DERIVADO,
  ]);
  return tablaConfigurable(ENCABEZADOS_CSV, filas, FORMATO_CSV);
}
