// ═══════════════════════════════════════════════════════════════════════════
// EL DESGLOSE DEL PROVEEDOR DE PEAJE — FASE 5, el PoC del Plaud #2.
//
// La recomendación literal de la sesión con Transportes Innovativos: "el
// agente toma el desglose del proveedor [...] y cruza [...] marcando
// discrepancias automáticamente". El desglose que IAVE/PASE/TeleVía mandan
// cada corte NO es un CFDI: es una tabla de cruces (fecha, caseta, importe,
// TAG) en Excel/CSV/PDF, sin UUID y sin XML — por eso no cabe en el camino
// del consolidado (`consolidado.ts`) y tiene tablas propias (0106).
//
// ── QUÉ CRUZA Y QUÉ NO (la nota de honestidad del PoC) ───────────────────
//
// v1 cruza contra lo que Likida YA SABE: los gastos de caseta de los viajes
// (fecha ±1 día, monto exacto primero, después tolerancia de rondeo). El
// cruce contra el GPS del TMS del cliente NO se puede afirmar sin acceso a su
// TMS: queda documentado como v2, nunca como tarjeta viva.
//
// ── LA REGLA DURA, LA MISMA DEL CONSOLIDADO ──────────────────────────────
//
// "Ante la duda no se adivina." Dos candidatos igual de buenos NO ligan la
// línea: queda `no_cuadra` con el porqué en `detalle`, para que un humano
// decida viendo lo mismo que vio el cruce. Y a diferencia del consolidado,
// AQUÍ NO SE ESCRIBE EN `gasto` NI EN NADA FISCAL: el resultado es una
// anotación sobre el archivo del proveedor, recalculable con re-correr el
// cruce — por eso re-conciliar es idempotente sin guardias de carrera.
//
// De lo conciliado sale la bitácora de la RMF 2026 regla 9.1.8, fr. II
// (ficha `normas/rmf-2026-9.1.8.yaml`): la bitácora de viaje que COINCIDE con
// el estado de cuenta del sistema electrónico de pago. La bitácora NUNCA
// afirma que el estímulo del 50% (LIF 2026 art. 20-A-V) proceda — solo que
// estas líneas están conciliadas; el resto corre por cuenta del contribuyente
// y la leyenda lo dice con todas sus letras.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo } from '../pg';
import { logger } from '@/lib/logger';
import { enLotes } from '../lotes';
import { round2 } from '@/lib/formato';
import { toCsv } from '../export';
import { leerArchivoUniversal, ArchivoNoSoportado } from './archivo';
import { diasDeDiferencia, VENTANA_DIAS_FECHA, TOLERANCIA_MONTO_MXN } from './consolidado';
import { registrarCorrida } from '../agentes/corridas';
import { contextoEvidenciaGps, llaveUnidadDia } from '../peajes/evidencia_gps';

/**
 * La tolerancia del segundo pase: rondeos de centavos entre lo que el
 * proveedor declara en su desglose y lo que el ticket/CFDI del viaje capturó.
 * Es LA MISMA constante del consolidado ($1 MXN) y por la misma razón: $10 de
 * diferencia son otra transacción, no un rondeo. La diferencia admitida SE
 * ESCRIBE en `diferencia` — se admite, no se esconde.
 */
export const TOLERANCIA_CENTAVOS_MXN = TOLERANCIA_MONTO_MXN;

/** Tope de líneas por desglose. Más que esto ya no es un corte de 10 días de
 *  una flota mediana — es un archivo equivocado, y se dice en vez de importar
 *  a medias. */
export const MAX_LINEAS_DESGLOSE = 5000;

// ═══════════════════════════════════════════════════════════════════════════
// 1. EL PARSEO — puro sobre filas/texto, para probarlo sin archivos reales.
// ═══════════════════════════════════════════════════════════════════════════

export interface LineaDesgloseParseada {
  /** Renglón dentro del archivo (0-based tras el encabezado) — orden estable. */
  indice: number;
  /** ISO YYYY-MM-DD, o null si la celda no se pudo leer como fecha. */
  fecha: string | null;
  caseta: string | null;
  monto: number;
  tag: string | null;
}

export type ResultadoParseo =
  | { ok: true; lineas: LineaDesgloseParseada[]; avisos: string[] }
  /** `motivo` dice QUÉ faltó o QUÉ no se entendió — jamás se adivina. */
  | { ok: false; motivo: string };

type Celda = string | number | boolean | null | undefined;

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = (c: Celda) => sinAcentos(String(c ?? '')).trim().toLowerCase();

// Los encabezados en español que los desgloses reales usan. Tolerantes a
// variantes ("Fecha de cruce", "Plaza de cobro", "No. de TAG"), pero cada
// patrón se queda corto A PROPÓSITO antes que matchear de más: una columna
// mal identificada cruza montos contra la columna equivocada sin avisar.
const PATRON_FECHA = /\bfecha\b|\bdia\b|fec\.\s*cruce/;
const PATRON_CASETA = /caseta|plaza|tramo|estacion|punto de cobro|autopista|caseta de cobro|nombre de la plaza/;
const PATRON_MONTO = /importe|monto|\btotal\b|cargo|costo|cuota|tarifa|peaje/;
// Columnas que PARECEN monto y no son la que se cruza: el cruce es contra
// `gasto.monto` (lo pagado), no contra IVA, subtotal ni saldo del TAG.
const PATRON_MONTO_EXCLUIR = /\biva\b|saldo|sub\s*-?\s*total|folio|km|litro|descuento/;
const PATRON_MONTO_TOTAL = /total/;
const PATRON_TAG = /\btag\b|etiqueta|dispositivo|telepeaje|medio de pago/;

export interface ColumnasDetectadas {
  fecha: number; caseta: number; monto: number; tag: number | null;
}

/**
 * Identifica qué columna es qué en una fila de encabezados. Devuelve la
 * detección o la lista de lo que FALTÓ — el mensaje de error del importador
 * nombra la columna exacta, nunca "formato inválido".
 *
 * Si hay más de una candidata a monto, gana la que diga "total" (el pagado
 * con IVA — que es lo que `gasto.monto` guarda); si ninguna lo dice, la
 * primera. Se documenta porque un desglose con "Importe" y "Total" a la vez
 * cruzaría ~16% abajo si tomara el importe sin IVA.
 */
export function detectarColumnas(encabezados: Celda[]): { ok: true; columnas: ColumnasDetectadas } | { ok: false; faltantes: string[] } {
  const n = encabezados.map(normalizar);
  const idxDe = (patron: RegExp, excluir?: RegExp) =>
    n.map((h, i) => ({ h, i })).filter(({ h }) => h && patron.test(h) && !(excluir && excluir.test(h)));

  const fechas = idxDe(PATRON_FECHA);
  const casetas = idxDe(PATRON_CASETA);
  const montos = idxDe(PATRON_MONTO, PATRON_MONTO_EXCLUIR);
  const tags = idxDe(PATRON_TAG);

  const faltantes: string[] = [];
  if (fechas.length === 0) faltantes.push('fecha');
  if (casetas.length === 0) faltantes.push('caseta');
  if (montos.length === 0) faltantes.push('importe');
  if (faltantes.length > 0) return { ok: false, faltantes };

  const monto = montos.find(({ h }) => PATRON_MONTO_TOTAL.test(h)) ?? montos[0];
  // Una columna no puede ser dos cosas: si "caseta" y "tag" cayeron en el
  // mismo índice ("TAG de la caseta"), el tag se descarta antes que duplicar.
  const tag = tags.find(({ i }) => i !== casetas[0].i && i !== monto.i && i !== fechas[0].i) ?? null;
  return {
    ok: true,
    columnas: { fecha: fechas[0].i, caseta: casetas[0].i, monto: monto.i, tag: tag ? tag.i : null },
  };
}

/** Serial de Excel (días desde 1899-12-30) → ISO. El rango acota a fechas
 *  plausibles (1954-2064): un "45892" suelto en una celda de fecha es un
 *  serial; un "189" es un monto perdido y NO se convierte en fecha. */
const EPOCH_EXCEL_MS = Date.UTC(1899, 11, 30);
function fechaDeSerialExcel(serial: number): string | null {
  if (serial < 20_000 || serial > 60_000) return null;
  return new Date(EPOCH_EXCEL_MS + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * La fecha de una celda, o `null` — nunca una adivinada. Acepta ISO
 * (YYYY-MM-DD), el formato mexicano dd/mm/aaaa (con o sin hora, que se
 * descarta: el cruce es por día) y el serial de Excel. Un dd/mm con "mes" > 12
 * es ilegible, NO se voltea a mm/dd: los desgloses de este dominio son
 * mexicanos y voltear en silencio movería el cruce de día sin que nadie lo vea.
 */
export function fechaDeCelda(v: Celda): string | null {
  if (typeof v === 'number') return fechaDeSerialExcel(v);
  const s = String(v ?? '').trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const [, a, m, d] = iso;
    return validarYmd(Number(a), Number(m), Number(d));
  }

  const mx = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s|$)/.exec(s);
  if (mx) {
    const d = Number(mx[1]);
    const m = Number(mx[2]);
    let a = Number(mx[3]);
    if (a < 100) a += 2000; // "05/08/26" — el siglo corto de los reportes
    return validarYmd(a, m, d);
  }
  return null;
}

function validarYmd(a: number, m: number, d: number): string | null {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  // El 31/02 pasa el rango pero no existe: Date lo recorre a marzo y aquí rebota.
  if (fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
  return fecha.toISOString().slice(0, 10);
}

/** El monto de una celda ("$1,234.56", "MXN 189.00", 189), o `null`. */
export function montoDeCelda(v: Celda): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
  const s = String(v ?? '').replace(/mxn|\$|,|\s/gi, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return round2(Number(s));
}

/** ¿Fila de totales/pie? Sin fecha legible y con un rótulo de suma: se salta
 *  y se cuenta en los avisos — un "TOTAL $4,580" importado como cruce
 *  duplicaría el periodo entero. */
function esFilaDeTotal(fila: Celda[]): boolean {
  return fila.some((c) => /^\s*(sub)?total(es)?\b/i.test(String(c ?? '')));
}

/**
 * El parseo de una hoja (Excel/CSV ya convertidos a matriz de celdas). Busca
 * el renglón de encabezados en los primeros 15 (los desgloses reales traen
 * título y datos del cliente arriba) y de ahí para abajo lee líneas.
 *
 * Qué entra y qué se avisa:
 *  - fila con monto y sin fecha legible → ENTRA con fecha null (será
 *    `sin_contraparte` con su motivo — visible, no tragada);
 *  - fila sin monto legible → se salta y SE CUENTA en avisos;
 *  - fila de totales → se salta y se cuenta.
 */
export function parsearDesgloseHoja(filas: Celda[][]): ResultadoParseo {
  const TOPE_BUSQUEDA_ENCABEZADO = 15;
  let columnas: ColumnasDetectadas | null = null;
  let filaEncabezado = -1;
  let mejorIntento: { faltantes: string[]; encabezados: Celda[] } | null = null;

  for (let i = 0; i < Math.min(filas.length, TOPE_BUSQUEDA_ENCABEZADO); i++) {
    const det = detectarColumnas(filas[i]);
    if (det.ok) {
      columnas = det.columnas;
      filaEncabezado = i;
      break;
    }
    const conTexto = filas[i].filter((c) => String(c ?? '').trim() !== '');
    if (conTexto.length >= 2 && (!mejorIntento || det.faltantes.length < mejorIntento.faltantes.length)) {
      mejorIntento = { faltantes: det.faltantes, encabezados: conTexto };
    }
  }

  if (!columnas) {
    const faltantes = mejorIntento?.faltantes ?? ['fecha', 'caseta', 'importe'];
    const vistos = mejorIntento
      ? ` Encabezados leídos: ${mejorIntento.encabezados.slice(0, 8).map((c) => `«${String(c).trim()}»`).join(', ')}.`
      : '';
    return {
      ok: false,
      motivo: `No encontré la columna de ${faltantes.join(' ni de ')} en el archivo.${vistos} ` +
        'El desglose necesita columnas de fecha, caseta e importe (el TAG es opcional) — no voy a adivinar cuál es cuál.',
    };
  }

  const lineas: LineaDesgloseParseada[] = [];
  let saltadasSinMonto = 0;
  let saltadasTotales = 0;
  for (let i = filaEncabezado + 1; i < filas.length; i++) {
    const fila = filas[i];
    if (fila.every((c) => String(c ?? '').trim() === '')) continue; // renglón en blanco
    const fecha = fechaDeCelda(fila[columnas.fecha]);
    if (fecha === null && esFilaDeTotal(fila)) { saltadasTotales++; continue; }
    const monto = montoDeCelda(fila[columnas.monto]);
    if (monto === null) { saltadasSinMonto++; continue; }
    const caseta = String(fila[columnas.caseta] ?? '').trim() || null;
    const tag = columnas.tag === null ? null : String(fila[columnas.tag] ?? '').trim() || null;
    lineas.push({ indice: lineas.length, fecha, caseta, monto, tag });
  }

  const avisos: string[] = [];
  if (saltadasSinMonto > 0) avisos.push(`Se saltaron ${saltadasSinMonto} filas sin importe legible.`);
  if (saltadasTotales > 0) avisos.push(`Se saltaron ${saltadasTotales} filas de totales.`);
  const sinFecha = lineas.filter((l) => l.fecha === null).length;
  if (sinFecha > 0) avisos.push(`${sinFecha} líneas no traen fecha legible: entran, pero el cruce no puede ligarlas solo.`);
  return { ok: true, lineas, avisos };
}

/**
 * El parseo del TEXTO de un PDF (la capa de texto que `leerArchivoUniversal`
 * extrae). Best-effort declarado: reconoce renglones «fecha … caseta … monto»
 * (con hora y $ opcionales) y saca el TAG si un token con su forma viene en
 * medio. Un PDF cuyo texto no siga ese patrón se rechaza DICIENDO que se
 * prefiere el Excel/CSV — nunca se importa la mitad de un desglose.
 */
export function parsearDesgloseTextoPdf(texto: string): ResultadoParseo {
  const RENGLON = /^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s+(.+?)\s+\$?\s*(-?[\d,]+\.\d{2})\s*$/;
  const TAG_TOKEN = /\b([A-Z]{2,6}\s?\d{6,11})\b/;

  const lineas: LineaDesgloseParseada[] = [];
  for (const cruda of texto.split('\n')) {
    const m = RENGLON.exec(cruda.trim());
    if (!m) continue;
    const fecha = fechaDeCelda(m[1]);
    const monto = montoDeCelda(m[3]);
    if (monto === null) continue;
    let caseta = m[2].trim();
    let tag: string | null = null;
    const t = TAG_TOKEN.exec(caseta);
    if (t) {
      tag = t[1].replace(/\s/g, '');
      caseta = caseta.replace(t[0], '').replace(/\s{2,}/g, ' ').trim();
    }
    lineas.push({ indice: lineas.length, fecha, caseta: caseta || null, monto, tag });
  }

  if (lineas.length === 0) {
    return {
      ok: false,
      motivo: 'El PDF trae texto pero no reconocí renglones de cruce (fecha, caseta, importe). ' +
        'Mándame el desglose en Excel o CSV — importar un PDF a medias produciría una conciliación que miente.',
    };
  }
  return { ok: true, lineas, avisos: [] };
}

const EXT_HOJA = new Set(['xlsx', 'xls', 'csv', 'tsv', 'ods']);

/**
 * El despachador por tipo de archivo.
 *
 * - Excel/CSV: se leen TODAS las filas con XLSX directo (la misma librería de
 *   `leerArchivoUniversal`). No se usa su extracto aquí a propósito: ese
 *   extracto viaja al chat y por diseño se corta a 60 filas por hoja — un
 *   desglose de 10 días las rebasa, e importar 60 de 800 líneas sería una
 *   conciliación que miente.
 * - PDF: SÍ pasa por `leerArchivoUniversal` (su parser de PDF ya distingue
 *   texto de escaneo). Si el extracto viene recortado, se rechaza entero y
 *   se dice por qué — nunca medio desglose.
 * - XML: se redirige al camino del CFDI consolidado, que ya existe.
 */
export async function parsearArchivoDesglose(nombre: string, buffer: Buffer): Promise<ResultadoParseo> {
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre.trim())?.[1] ?? '').toLowerCase();

  if (EXT_HOJA.has(ext)) {
    let filas: Celda[][];
    try {
      const libro = XLSX.read(buffer, { type: 'buffer' });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      if (!hoja) return { ok: false, motivo: 'El archivo no trae ninguna hoja con datos.' };
      filas = XLSX.utils.sheet_to_json<Celda[]>(hoja, { header: 1, raw: true, defval: '' });
      const r = parsearDesgloseHoja(filas);
      if (r.ok && libro.SheetNames.length > 1) {
        r.avisos.push(`El archivo trae ${libro.SheetNames.length} hojas; se leyó solo la primera («${libro.SheetNames[0]}»).`);
      }
      return r;
    } catch (e) {
      logger.error('desglose_peaje.parseo_hoja', { err: e instanceof Error ? e.message : String(e) });
      return { ok: false, motivo: 'No pude abrir el archivo como Excel/CSV. Revisa que no esté dañado o protegido con contraseña.' };
    }
  }

  if (ext === 'xml') {
    return {
      ok: false,
      motivo: 'Un XML es un CFDI: el consolidado del TAG entra por la otra forma de esta pantalla (o por WhatsApp). Aquí va el DESGLOSE del proveedor en Excel, CSV o PDF.',
    };
  }

  try {
    const leido = await leerArchivoUniversal(nombre, buffer);
    if (leido.clase !== 'pdf') {
      return { ok: false, motivo: `No sé leer un desglose desde un archivo .${ext}. Mándalo en Excel, CSV o PDF.` };
    }
    if (leido.extracto.includes('no trae texto seleccionable')) {
      return { ok: false, motivo: 'Este PDF parece un escaneo (sin texto seleccionable). Pídele al proveedor el desglose en Excel/CSV, o un PDF con texto.' };
    }
    if (leido.extracto.includes('[recortado')) {
      // El extracto de `leerArchivoUniversal` se corta a 15k chars por diseño
      // (viaja al chat). Un desglose que no cabe completo NO se importa a
      // medias: la mitad de un periodo conciliado es peor que nada.
      return { ok: false, motivo: 'El PDF es más largo de lo que puedo leer completo. Mándame el desglose en Excel o CSV — no voy a importar la mitad de un periodo.' };
    }
    return parsearDesgloseTextoPdf(leido.extracto);
  } catch (e) {
    if (e instanceof ArchivoNoSoportado) {
      return { ok: false, motivo: `No sé leer archivos ${e.extension}. El desglose entra en Excel, CSV o PDF.` };
    }
    logger.error('desglose_peaje.parseo_pdf', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: 'No pude leer el PDF. Revisa que no esté dañado, o mándalo en Excel/CSV.' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. EL CRUCE — puro: líneas + gastos de caseta → tres cubetas. Sin base.
// ═══════════════════════════════════════════════════════════════════════════

export type EstatusLineaDesglose = 'cuadra' | 'no_cuadra' | 'sin_contraparte';

export interface GastoCaseta {
  id: string;
  viajeId: string;
  monto: number;
  /** ISO YYYY-MM-DD. El fondo del cruce ya viene filtrado a con-fecha. */
  fecha: string;
}

export interface CruceLinea {
  estatus: EstatusLineaDesglose;
  /** Solo en `cuadra`. */
  viajeId: string | null;
  gastoId: string | null;
  /** Pesos MEDIDOS: en cuadra los centavos admitidos (0 = exacto medido); en
   *  no_cuadra por monto, contra el candidato más cercano. `null` cuando no
   *  hay contraparte única contra quién medir — NULL ≠ 0. */
  diferencia: number | null;
  /** El porqué, para un humano. Sin datos personales. */
  detalle: Record<string, unknown> | null;
}

interface CandidatoEvaluado { gasto: GastoCaseta; dias: number; diff: number }

const resumenCandidato = (c: CandidatoEvaluado) =>
  ({ gastoId: c.gasto.id, monto: c.gasto.monto, fecha: c.gasto.fecha });

/**
 * EL CRUCE. Reglas, en orden, todas documentadas porque cada una mueve pesos:
 *
 * 1. Línea sin fecha → `sin_contraparte` (motivo `sin_fecha`). Cruzar por
 *    monto solo, contra el historial entero, es justo lo que no se hace —
 *    misma doctrina que `conciliarLineas`.
 * 2. Ventana: gastos de caseta a ±`VENTANA_DIAS_FECHA` (1) días.
 * 3. Monto EXACTO primero. Si hay varios exactos, gana el de fecha más
 *    cercana; empate de fecha = ambigua → `no_cuadra` con los candidatos en
 *    `detalle` (no se adivina).
 * 4. Sin exacto: tolerancia de `TOLERANCIA_CENTAVOS_MXN` ($1, rondeos). Gana
 *    el de menor |diferencia| y, a igual diferencia, el de fecha más cercana;
 *    empate en ambas = ambigua. La diferencia admitida SE ESCRIBE.
 * 5. Ventana con gastos pero ninguno dentro de tolerancia → `no_cuadra` con
 *    la diferencia contra el más cercano en monto (la discrepancia marcada).
 * 6. Ventana vacía → `sin_contraparte`; si su contraparte existía pero otra
 *    línea (idéntica) ya la reclamó, el motivo lo dice
 *    (`contraparte_ya_reclamada`) — la primera línea del archivo gana.
 *
 * Un gasto que cuadra SALE del fondo: dos líneas del desglose no pueden
 * reclamar el mismo comprobante. Las líneas se procesan en el orden del
 * archivo (`indice`).
 */
export function cruzarLineasDesglose(
  lineas: ReadonlyArray<{ fecha: string | null; monto: number }>,
  gastos: readonly GastoCaseta[],
): CruceLinea[] {
  let disponibles = [...gastos];
  const resultados: CruceLinea[] = [];

  for (const linea of lineas) {
    if (!linea.fecha) {
      resultados.push({
        estatus: 'sin_contraparte', viajeId: null, gastoId: null, diferencia: null,
        detalle: { motivo: 'sin_fecha' },
      });
      continue;
    }
    const dia = linea.fecha.slice(0, 10);
    const evaluar = (fondo: GastoCaseta[]): CandidatoEvaluado[] => fondo
      .map((g) => ({ gasto: g, dias: diasDeDiferencia(g.fecha.slice(0, 10), dia), diff: round2(Math.abs(g.monto - linea.monto)) }))
      .filter((c) => c.dias <= VENTANA_DIAS_FECHA);

    const ventana = evaluar(disponibles);

    if (ventana.length === 0) {
      const habiaEnFondoCompleto = evaluar([...gastos]).length > 0;
      resultados.push({
        estatus: 'sin_contraparte', viajeId: null, gastoId: null, diferencia: null,
        detalle: { motivo: habiaEnFondoCompleto ? 'contraparte_ya_reclamada' : 'sin_gastos_en_ventana' },
      });
      continue;
    }

    const cuadrar = (candidatos: CandidatoEvaluado[], motivoAmbigua: string): CruceLinea | null => {
      // Menor diferencia de monto manda; la fecha más cercana desempata.
      const orden = [...candidatos].sort((a, b) => (a.diff - b.diff) || (a.dias - b.dias));
      const mejor = orden[0];
      const empatados = orden.filter((c) => c.diff === mejor.diff && c.dias === mejor.dias);
      if (empatados.length > 1) {
        return {
          estatus: 'no_cuadra', viajeId: null, gastoId: null, diferencia: null,
          detalle: { motivo: motivoAmbigua, candidatos: empatados.map(resumenCandidato) },
        };
      }
      disponibles = disponibles.filter((g) => g.id !== mejor.gasto.id);
      return {
        estatus: 'cuadra',
        viajeId: mejor.gasto.viajeId,
        gastoId: mejor.gasto.id,
        // Con signo: positivo = el desglose cobra más que lo comprobado.
        diferencia: round2(linea.monto - mejor.gasto.monto),
        detalle: { gastoId: mejor.gasto.id, montoGasto: mejor.gasto.monto, fechaGasto: mejor.gasto.fecha },
      };
    };

    const exactos = ventana.filter((c) => c.diff < 0.005);
    if (exactos.length > 0) {
      resultados.push(cuadrar(exactos, 'ambigua_monto_exacto')!);
      continue;
    }

    const tolerables = ventana.filter((c) => c.diff <= TOLERANCIA_CENTAVOS_MXN);
    if (tolerables.length > 0) {
      resultados.push(cuadrar(tolerables, 'ambigua_en_tolerancia')!);
      continue;
    }

    // Hay contraparte en la ventana, pero el monto no aguanta ni el rondeo:
    // es LA discrepancia que este agente existe para marcar.
    const masCercano = [...ventana].sort((a, b) => (a.diff - b.diff) || (a.dias - b.dias))[0];
    resultados.push({
      estatus: 'no_cuadra', viajeId: null, gastoId: null,
      diferencia: round2(linea.monto - masCercano.gasto.monto),
      detalle: { motivo: 'monto_distinto', candidato: resumenCandidato(masCercano) },
    });
  }
  return resultados;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. EL IO — importar, conciliar, resumir. Errores supabase POR VALOR.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoImportar =
  | { ok: true; desgloseId: string; totalLineas: number; avisos: string[] }
  | { ok: false; motivo: string };

/**
 * Importa el archivo del proveedor: parsea, mide el periodo (min/max real de
 * las fechas — nunca inventado) y guarda desglose + líneas. TODA línea nace
 * `sin_contraparte` (default de la 0106): sin cruce no se afirma nada.
 *
 * Si las líneas no se pueden guardar completas, el desglose se borra (cascade)
 * en vez de quedar a medias: medio desglose en pantalla es un % conciliado
 * que miente.
 */
export async function importarDesglose(
  tenantId: string,
  archivo: { nombre: string; buffer: Buffer; proveedor?: string },
): Promise<ResultadoImportar> {
  const parseo = await parsearArchivoDesglose(archivo.nombre, archivo.buffer);
  if (!parseo.ok) return parseo;
  if (parseo.lineas.length === 0) {
    return { ok: false, motivo: 'El archivo se leyó pero no traía ninguna línea con importe.' };
  }
  if (parseo.lineas.length > MAX_LINEAS_DESGLOSE) {
    return {
      ok: false,
      motivo: `El archivo trae ${parseo.lineas.length} líneas y el tope por desglose es ${MAX_LINEAS_DESGLOSE}. Pártelo por periodo y súbelo en partes.`,
    };
  }

  const fechas = parseo.lineas.map((l) => l.fecha).filter((f): f is string => f !== null).sort();
  const { data: fila, error: errDesglose } = await acotada(supabaseAdmin()
    .from('desglose_peaje')
    .insert({
      tenant_id: tenantId,
      proveedor: archivo.proveedor?.trim() || null,
      periodo_desde: fechas[0] ?? null,
      periodo_hasta: fechas[fechas.length - 1] ?? null,
      archivo_nombre: archivo.nombre,
    })
    .select('id')
    .single(), 'desglose_peaje.insertar');
  if (errDesglose || !fila) {
    logger.error('desglose_peaje.insertar_error', { tenant: tenantId, err: errDesglose?.message ?? 'sin id' });
    return { ok: false, motivo: 'No se pudo guardar el desglose. Inténtalo de nuevo.' };
  }
  const desgloseId = fila.id as string;

  const filasLinea = parseo.lineas.map((l) => ({
    tenant_id: tenantId,
    desglose_id: desgloseId,
    indice: l.indice,
    fecha: l.fecha,
    caseta: l.caseta,
    monto: l.monto,
    tag: l.tag,
  }));
  const LOTE = 500;
  const lotes: typeof filasLinea[] = [];
  for (let i = 0; i < filasLinea.length; i += LOTE) lotes.push(filasLinea.slice(i, i + LOTE));
  const escritos = await enLotes(lotes, 2, async (lote) => {
    const { error } = await acotada(supabaseAdmin().from('desglose_peaje_linea').insert(lote), 'desglose_peaje.insertar_lineas');
    if (error) throw new Error(error.message);
  });
  const fallo = escritos.find((r) => 'error' in r);
  if (fallo) {
    logger.error('desglose_peaje.lineas_error', {
      tenant: tenantId, desglose: desgloseId,
      err: 'error' in fallo && fallo.error instanceof Error ? fallo.error.message : 'fallo de lote',
    });
    // Limpieza best-effort: el cascade borra las líneas que sí entraron.
    const { error: errBorrar } = await supabaseAdmin().from('desglose_peaje').delete().eq('id', desgloseId).eq('tenant_id', tenantId);
    if (errBorrar) logger.error('desglose_peaje.limpieza_error', { tenant: tenantId, desglose: desgloseId, err: errBorrar.message });
    return { ok: false, motivo: 'No se pudieron guardar las líneas del desglose. No quedó a medias: inténtalo de nuevo.' };
  }

  return { ok: true, desgloseId, totalLineas: parseo.lineas.length, avisos: parseo.avisos };
}

export interface ResumenCruceDesglose {
  desgloseId: string;
  total: number;
  cuadra: number;
  noCuadra: number;
  sinContraparte: number;
  /** Líneas cuyo resultado no se pudo escribir (siguen con su estatus previo). */
  noEscritas: number;
}

/**
 * Corre el cruce de un desglose contra los gastos de caseta del tenant y
 * escribe estatus/diferencia/viaje_id/detalle por línea. Re-correrlo es
 * idempotente: TODO se recalcula contra los gastos de hoy (es anotación,
 * no sello fiscal — ver cabecera).
 *
 * Registra la corrida en la bitácora del agente `peajes` (0102; el dominio ya
 * incluye 'peajes', no hubo que ampliarlo). `registrarCorrida` nunca lanza.
 */
export async function conciliarDesglose(
  tenantId: string,
  desgloseId: string,
  disparo: 'cron' | 'manual' = 'manual',
): Promise<ResumenCruceDesglose> {
  // La existencia se comprueba ANTES de anotar nada: un id viejo o ajeno no
  // debe dejar una corrida fantasma en la bitácora del agente.
  const { data: existe, error: errExiste } = await acotada(supabaseAdmin()
    .from('desglose_peaje')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', desgloseId)
    .maybeSingle(), 'desglose_peaje.existe');
  if (errExiste) throw new Error(`conciliarDesglose: ${errExiste.message}`);
  if (!existe) throw new Error('conciliarDesglose: ese desglose no existe en esta flota');

  const inicio = new Date();
  try {
    const resumen = await conciliarDesgloseInterno(tenantId, desgloseId);
    await registrarCorrida(tenantId, 'peajes', {
      inicio,
      fin: new Date(),
      estado: resumen.noEscritas > 0 ? 'parcial' : 'ok',
      disparo,
      tareasHechas: resumen.cuadra,
      tareasTotal: resumen.total,
      resumen: { ...resumen },
      error: resumen.noEscritas > 0
        ? `${resumen.noEscritas} líneas no se pudieron escribir; el siguiente cruce las recalcula.`
        : undefined,
    });
    return resumen;
  } catch (e) {
    await registrarCorrida(tenantId, 'peajes', {
      inicio,
      fin: new Date(),
      estado: 'fallo',
      disparo,
      error: 'El cruce del desglose no se pudo completar. El detalle quedó en los registros del sistema.',
    });
    throw e;
  }
}

async function conciliarDesgloseInterno(tenantId: string, desgloseId: string): Promise<ResumenCruceDesglose> {
  // 1) Las líneas del desglose, en el orden del archivo. Error de lectura
  //    LANZA: "no hay líneas" y "no pude leer" llevan a acuses opuestos.
  // `traerTodo` y no `.limit(MAX_LINEAS_DESGLOSE)` (auditoría de escala 15k):
  // PostgREST aplica min(limit, max_rows), así que un `.limit(5000)` entrega
  // 1,000 filas y NADA avisa — el cruce corría sobre la quinta parte del
  // archivo. El tope de importación sigue viviendo en la ingesta; aquí se
  // pagina lo que haya.
  const filas = await traerTodo<{ id: unknown; indice: unknown; fecha: unknown; monto: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('desglose_peaje_linea')
      .select('id, indice, fecha, monto', conteo(d))
      .eq('tenant_id', tenantId)
      .eq('desglose_id', desgloseId)
      .order('indice').order('id')
      .range(d, h), 'desglose_peaje.leer_lineas'),
    'desglose_peaje.leer_lineas',
  );
  const lineas = filas.map((f) => ({
    id: String(f.id),
    fecha: (f.fecha as string | null) ?? null,
    monto: Number(f.monto),
  }));
  const resumen: ResumenCruceDesglose = {
    desgloseId, total: lineas.length, cuadra: 0, noCuadra: 0, sinContraparte: 0, noEscritas: 0,
  };
  if (lineas.length === 0) return resumen;

  // 2) El fondo: gastos de CASETA del tenant en el rango de fechas de las
  //    líneas ± la ventana. Solo concepto 'caseta' a propósito: cruzar contra
  //    diésel o viáticos "por si el monto coincide" es adivinar con esteroides.
  const fechas = lineas.map((l) => l.fecha).filter((f): f is string => f !== null).sort();
  let gastos: GastoCaseta[] = [];
  if (fechas.length > 0) {
    const desde = sumarDias(fechas[0], -VENTANA_DIAS_FECHA);
    const hasta = sumarDias(fechas[fechas.length - 1], VENTANA_DIAS_FECHA);
    // Misma razón que arriba: con ~45,000 gastos/mes, las casetas del rango
    // pasan de 1,000 y el `.limit(5000)` recortado marcaba `sin_contraparte`
    // líneas que SÍ tenían contraparte.
    const data = await traerTodo<{ id: unknown; viaje_id: unknown; monto: unknown; fecha: unknown }>(
      (d, h) => acotada(supabaseAdmin()
        .from('gasto')
        .select('id, viaje_id, monto, fecha', conteo(d))
        .eq('tenant_id', tenantId)
        .eq('concepto', 'caseta')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('id').range(d, h), 'desglose_peaje.gastos_caseta'),
      'desglose_peaje.gastos_caseta',
    );
    gastos = data
      .filter((g) => g.fecha !== null && g.viaje_id !== null)
      .map((g) => ({
        id: String(g.id),
        viajeId: String(g.viaje_id),
        monto: Number(g.monto),
        fecha: String(g.fecha).slice(0, 10),
      }));
  }

  // 3) El cruce puro y 4) la escritura por línea, en lotes (REND-C1: en serie
  //    un desglose de 1,000 líneas rebasaría maxDuration). Best-effort por
  //    línea: la que no se pueda escribir conserva su estatus previo y se
  //    cuenta — el resumen dice lo que quedó EN LA BASE, no lo que se calculó.
  const cruces = cruzarLineasDesglose(lineas, gastos);
  const escrituras = await enLotes(cruces.map((c, i) => ({ c, lineaId: lineas[i].id })), 10, async ({ c, lineaId }) => {
    const { error } = await acotada(supabaseAdmin()
      .from('desglose_peaje_linea')
      .update({
        estatus: c.estatus,
        viaje_id: c.viajeId,
        diferencia: c.diferencia,
        detalle: c.detalle,
      })
      .eq('id', lineaId)
      .eq('tenant_id', tenantId), 'desglose_peaje.escribir_linea');
    if (error) throw new Error(error.message);
    return c.estatus;
  });

  for (let i = 0; i < escrituras.length; i++) {
    const r = escrituras[i];
    if ('error' in r) {
      resumen.noEscritas++;
      logger.error('desglose_peaje.linea_no_escrita', {
        tenant: tenantId, desglose: desgloseId, linea: lineas[i].id,
        err: r.error instanceof Error ? r.error.message : String(r.error),
      });
      continue;
    }
    if (r.ok === 'cuadra') resumen.cuadra++;
    else if (r.ok === 'no_cuadra') resumen.noCuadra++;
    else resumen.sinContraparte++;
  }

  logger.info('desglose_peaje.cruce', { tenant: tenantId, ...resumen });
  return resumen;
}

function sumarDias(fechaIso: string, delta: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. RESÚMENES PARA LA PANTALLA — el % conciliado es MEDIDO o es null.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResumenDesglose {
  desgloseId: string;
  proveedor: string | null;
  archivoNombre: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  creadoEn: string;
  total: number;
  cuadra: number;
  noCuadra: number;
  sinContraparte: number;
  /** % de líneas que cuadran, redondeado. `null` con cero líneas — no hay
   *  medición que dar. */
  pctCuadra: number | null;
}

async function agregarEstatus(tenantId: string, desgloseId: string): Promise<Pick<ResumenDesglose, 'total' | 'cuadra' | 'noCuadra' | 'sinContraparte' | 'pctCuadra'>> {
  // AUDITORÍA DE ESCALA 15k: aquí decía «el tope de importación garantiza que
  // cabe completo» sobre un `.limit(MAX_LINEAS_DESGLOSE)` — y la premisa era
  // FALSA: PostgREST aplica min(limit, max_rows), así que un `.limit(5000)`
  // entrega 1,000 filas sin error. `total` y `pctCuadra` se congelaban en
  // 1,000 — en el detalle Y EN EL ACUSE que se le manda al cliente. Se pagina
  // con `traerTodo`, que además exige demostrar que la lectura quedó completa.
  const filas = await traerTodo<{ estatus: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('desglose_peaje_linea')
      .select('estatus', conteo(d))
      .eq('tenant_id', tenantId)
      .eq('desglose_id', desgloseId)
      .order('id').range(d, h), 'desglose_peaje.agregar_estatus'),
    'desglose_peaje.agregar_estatus',
  );
  const cuenta = (e: EstatusLineaDesglose) => filas.filter((f) => f.estatus === e).length;
  const total = filas.length;
  const cuadra = cuenta('cuadra');
  return {
    total,
    cuadra,
    noCuadra: cuenta('no_cuadra'),
    sinContraparte: cuenta('sin_contraparte'),
    pctCuadra: total > 0 ? Math.round((cuadra / total) * 100) : null,
  };
}

/** El resumen de UN desglose (para el detalle y para el acuse). LANZA ante un
 *  error de lectura: un "0% conciliado" sobre una base caída es la mentira
 *  exacta que la regla del repo prohíbe. */
export async function resumenConciliacion(tenantId: string, desgloseId: string): Promise<ResumenDesglose | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('desglose_peaje')
    .select('id, proveedor, archivo_nombre, periodo_desde, periodo_hasta, creado_en')
    .eq('tenant_id', tenantId)
    .eq('id', desgloseId)
    .maybeSingle(), 'desglose_peaje.leer_desglose');
  if (error) throw new Error(`resumenConciliacion: ${error.message}`);
  if (!data) return null;
  return {
    desgloseId: String(data.id),
    proveedor: (data.proveedor as string | null) ?? null,
    archivoNombre: (data.archivo_nombre as string | null) ?? null,
    periodoDesde: (data.periodo_desde as string | null) ?? null,
    periodoHasta: (data.periodo_hasta as string | null) ?? null,
    creadoEn: String(data.creado_en),
    ...(await agregarEstatus(tenantId, desgloseId)),
  };
}

/** Los últimos desgloses de la flota, cada uno con su % conciliado MEDIDO. */
export async function listarDesgloses(tenantId: string, limite = 8): Promise<ResumenDesglose[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('desglose_peaje')
    .select('id, proveedor, archivo_nombre, periodo_desde, periodo_hasta, creado_en')
    .eq('tenant_id', tenantId)
    .order('creado_en', { ascending: false })
    .limit(limite), 'desglose_peaje.listar');
  if (error) throw new Error(`listarDesgloses: ${error.message}`);
  const out: ResumenDesglose[] = [];
  for (const d of data ?? []) {
    out.push({
      desgloseId: String(d.id),
      proveedor: (d.proveedor as string | null) ?? null,
      archivoNombre: (d.archivo_nombre as string | null) ?? null,
      periodoDesde: (d.periodo_desde as string | null) ?? null,
      periodoHasta: (d.periodo_hasta as string | null) ?? null,
      creadoEn: String(d.creado_en),
      ...(await agregarEstatus(tenantId, String(d.id))),
    });
  }
  return out;
}

export interface LineaDesgloseVista {
  id: string;
  indice: number;
  fecha: string | null;
  caseta: string | null;
  monto: number;
  tag: string | null;
  diferencia: number | null;
  /** Folio del viaje cuando la línea cuadra; null si el viaje no tiene folio. */
  viajeFolio: string | null;
  /** El motivo de `detalle` cuando no cuadra o no tiene contraparte. */
  motivo: string | null;
}

export interface DetalleDesglose {
  cuadra: LineaDesgloseVista[];
  noCuadra: LineaDesgloseVista[];
  sinContraparte: LineaDesgloseVista[];
}

/** Las líneas de un desglose por cubeta (hasta `limitePorCubeta` cada una),
 *  con el folio del viaje resuelto para las que cuadran. */
export async function detalleDesglose(tenantId: string, desgloseId: string, limitePorCubeta = 12): Promise<DetalleDesglose> {
  const traer = async (estatus: EstatusLineaDesglose) => {
    const { data, error } = await acotada(supabaseAdmin()
      .from('desglose_peaje_linea')
      .select('id, indice, fecha, caseta, monto, tag, diferencia, viaje_id, detalle')
      .eq('tenant_id', tenantId)
      .eq('desglose_id', desgloseId)
      .eq('estatus', estatus)
      .order('indice')
      .limit(limitePorCubeta), 'desglose_peaje.detalle');
    if (error) throw new Error(`detalleDesglose: ${error.message}`);
    return data ?? [];
  };
  const [cuadraCrudo, noCuadraCrudo, sinContraparteCrudo] = await Promise.all([
    traer('cuadra'), traer('no_cuadra'), traer('sin_contraparte'),
  ]);

  const viajeIds = [...new Set(cuadraCrudo.map((f) => f.viaje_id as string | null).filter((v): v is string => !!v))];
  let folioPorViaje = new Map<string, string | null>();
  if (viajeIds.length > 0) {
    const { data, error } = await acotada(supabaseAdmin()
      .from('viaje').select('id, folio').eq('tenant_id', tenantId).in('id', viajeIds), 'desglose_peaje.folios');
    if (error) throw new Error(`detalleDesglose: ${error.message}`);
    folioPorViaje = new Map((data ?? []).map((v) => [String(v.id), (v.folio as string | null) ?? null]));
  }

  const aVista = (f: Record<string, unknown>): LineaDesgloseVista => ({
    id: String(f.id),
    indice: Number(f.indice),
    fecha: (f.fecha as string | null) ?? null,
    caseta: (f.caseta as string | null) ?? null,
    monto: Number(f.monto),
    tag: (f.tag as string | null) ?? null,
    diferencia: f.diferencia === null || f.diferencia === undefined ? null : Number(f.diferencia),
    viajeFolio: f.viaje_id ? (folioPorViaje.get(String(f.viaje_id)) ?? null) : null,
    motivo: ((f.detalle as Record<string, unknown> | null)?.motivo as string | undefined) ?? null,
  });
  return {
    cuadra: cuadraCrudo.map(aVista),
    noCuadra: noCuadraCrudo.map(aVista),
    sinContraparte: sinContraparteCrudo.map(aVista),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. LA BITÁCORA RMF 9.1.8 — el documento de la fr. II, sin afirmar de más.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La leyenda que viaja CON la bitácora (pantalla y CSV). Cada renglón sale de
 * la ficha verificada `normas/rmf-2026-9.1.8.yaml`. La bitácora NUNCA afirma
 * que el estímulo proceda: dice qué produce este documento y qué corre por
 * cuenta del contribuyente.
 */
export const LEYENDAS_BITACORA_RMF_918: readonly string[] = [
  'Bitácora de cruces conciliados contra el desglose del proveedor de peaje — el documento de la fracción II de la regla 9.1.8 de la RMF 2026: viaje (origen y destino), caseta y monto que coinciden con el desglose del sistema electrónico de pago.',
  'Solo entran las líneas que cuadraron; las discrepancias y las líneas sin contraparte NO forman parte de esta bitácora.',
  'Este documento NO afirma que el estímulo del 50% de peaje (LIF 2026, art. 20, ap. A, fr. V) proceda. Corren por cuenta del contribuyente: el aviso de marzo con inventario vehicular por buzón tributario (fr. I), pagar con TAG o sistema electrónico y conservar los estados de cuenta (fr. III), la dedicación exclusiva al autotransporte, el uso de la Red Nacional de Autopistas de Cuota, ingresos anuales menores a 300 millones de pesos y no ser parte relacionada (LISR 179).',
  'La base del acreditamiento es el importe pagado SIN IVA con factor 0.5 (fr. IV). Esta bitácora lista el monto conciliado del desglose; NO calcula el estímulo — eso decídelo con tu contador.',
  'La columna posiciones_gps_dia es evidencia OPERATIVA adicional (cuántas posiciones GPS registró la unidad del viaje el día del cruce), no un requisito de la regla. «sin datos» significa GPS sin conectar o dato faltante — no invalida el cruce conciliado.',
];

export interface FilaBitacora {
  viajeFolio: string;
  origen: string;
  destino: string;
  fechaCruce: string;
  caseta: string;
  tag: string;
  montoConciliado: number;
  /** Posiciones GPS de la unidad del viaje el día del cruce (evidencia
   *  operativa, ver leyenda). Solo AFIRMA: n > 0. null = sin datos — GPS sin
   *  conectar, cero posiciones ese día (indistinguible del anterior sin más
   *  contexto), viaje sin unidad o fecha ilegible. Jamás un 0 que se leería
   *  como "la unidad no se movió". */
  posicionesGpsDia: number | null;
}

export interface BitacoraRmf918 {
  desgloseId: string;
  proveedor: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  filas: FilaBitacora[];
  leyendas: readonly string[];
}

/**
 * Puro: arma las filas de la bitácora desde líneas que CUADRAN y sus viajes.
 * Lo que el viaje no tiene se deja VACÍO (origen/destino/folio sin capturar):
 * una celda vacía es honesta; una inventada invalida el documento completo.
 */
export function filasBitacora(
  lineasCuadra: ReadonlyArray<{ fecha: string | null; caseta: string | null; monto: number; tag: string | null; viajeId: string | null }>,
  viajePorId: ReadonlyMap<string, { folio: string | null; origen: string | null; destino: string | null; unidadId?: string | null }>,
  /** `llaveUnidadDia(unidad, fecha)` → conteo (contextoEvidenciaGps). Sin el
   *  mapa, toda la columna sale `null` — "sin datos", no un cero. */
  posicionesPorUnidadDia?: ReadonlyMap<string, number>,
): FilaBitacora[] {
  return lineasCuadra
    .filter((l) => l.viajeId !== null)
    .map((l) => {
      const v = viajePorId.get(l.viajeId as string);
      const unidadId = v?.unidadId ?? null;
      const n = unidadId && l.fecha ? posicionesPorUnidadDia?.get(llaveUnidadDia(unidadId, l.fecha)) ?? 0 : 0;
      return {
        viajeFolio: v?.folio ?? '',
        origen: v?.origen ?? '',
        destino: v?.destino ?? '',
        fechaCruce: l.fecha ?? '',
        caseta: l.caseta ?? '',
        tag: l.tag ?? '',
        montoConciliado: l.monto,
        posicionesGpsDia: n > 0 ? n : null,
      };
    });
}

/** La bitácora de un desglose: solo sus líneas `cuadra`, con su viaje. */
export async function bitacoraRmf918(tenantId: string, desgloseId: string): Promise<BitacoraRmf918 | null> {
  const { data: desglose, error: errDesglose } = await acotada(supabaseAdmin()
    .from('desglose_peaje')
    .select('id, proveedor, periodo_desde, periodo_hasta')
    .eq('tenant_id', tenantId)
    .eq('id', desgloseId)
    .maybeSingle(), 'bitacora.desglose');
  if (errDesglose) throw new Error(`bitacoraRmf918: ${errDesglose.message}`);
  if (!desglose) return null;

  // `traerTodo` por lo mismo que `agregarEstatus`: la bitácora RMF 9.18 con
  // el `.limit(5000)` recortado a 1,000 salía INCOMPLETA — y es un documento
  // fiscal descargable, no una vista.
  const filas = await traerTodo<{ fecha: unknown; caseta: unknown; monto: unknown; tag: unknown; viaje_id: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('desglose_peaje_linea')
      .select('fecha, caseta, monto, tag, viaje_id', conteo(d))
      .eq('tenant_id', tenantId)
      .eq('desglose_id', desgloseId)
      .eq('estatus', 'cuadra')
      .order('indice').order('id')
      .range(d, h), 'bitacora.lineas'),
    'bitacora.lineas',
  );
  const lineas = filas.map((f) => ({
    fecha: (f.fecha as string | null) ?? null,
    caseta: (f.caseta as string | null) ?? null,
    monto: Number(f.monto),
    tag: (f.tag as string | null) ?? null,
    viajeId: (f.viaje_id as string | null) ?? null,
  }));

  const viajeIds = [...new Set(lineas.map((l) => l.viajeId).filter((v): v is string => !!v))];
  const viajePorId = new Map<string, { folio: string | null; origen: string | null; destino: string | null; unidadId: string | null }>();
  if (viajeIds.length > 0) {
    // `traerPorIds`: un `.in()` con miles de viajes se recorta a 1,000 en
    // silencio y además viaja en la URL (ver pg.ts).
    const data = await traerPorIds<{ id: unknown; folio: unknown; origen: unknown; destino: unknown; unidad_id: unknown }>(
      viajeIds,
      (tanda) => acotada(supabaseAdmin()
        .from('viaje').select('id, folio, origen, destino, unidad_id').eq('tenant_id', tenantId).in('id', tanda), 'bitacora.viajes'),
      'bitacora.viajes',
    );
    for (const v of data) {
      viajePorId.set(String(v.id), {
        folio: (v.folio as string | null) ?? null,
        origen: (v.origen as string | null) ?? null,
        destino: (v.destino as string | null) ?? null,
        unidadId: (v.unidad_id as string | null) ?? null,
      });
    }
  }

  // La columna `posiciones_gps_dia` sale de la MISMA resolución que usa el
  // panel (contextoEvidenciaGps): si el panel y la bitácora contaran distinto,
  // el contralor vería dos verdades. El costo es una consulta viaje→unidad
  // repetida — barato para un documento que se descarga a mano.
  const { posicionesPorUnidadDia } = await contextoEvidenciaGps(tenantId, lineas);

  return {
    desgloseId,
    proveedor: (desglose.proveedor as string | null) ?? null,
    periodoDesde: (desglose.periodo_desde as string | null) ?? null,
    periodoHasta: (desglose.periodo_hasta as string | null) ?? null,
    filas: filasBitacora(lineas, viajePorId, posicionesPorUnidadDia),
    leyendas: LEYENDAS_BITACORA_RMF_918,
  };
}

/**
 * El CSV descargable. La leyenda va PRIMERO como renglones «#» (Excel los
 * enseña como celdas de texto): un CSV que viaja sin su leyenda es una
 * bitácora que afirma de más en cuanto alguien la reenvía.
 */
export function bitacoraACsv(b: BitacoraRmf918): string {
  const encabezado = [
    ...b.leyendas.map((l) => `# ${l}`),
    `# Desglose: ${b.desgloseId}${b.proveedor ? ` · Proveedor: ${b.proveedor}` : ''}${b.periodoDesde && b.periodoHasta ? ` · Periodo medido: ${b.periodoDesde} a ${b.periodoHasta}` : ''}`,
    '#',
  ].join('\n');
  const tabla = b.filas.length === 0
    ? '# (Sin líneas conciliadas todavía: la bitácora se llena con los cruces que cuadran.)\n'
    : toCsv(b.filas.map((f) => ({
      viaje: f.viajeFolio,
      origen: f.origen,
      destino: f.destino,
      fecha_cruce: f.fechaCruce,
      caseta: f.caseta,
      tag: f.tag,
      monto_conciliado: f.montoConciliado,
      // «sin datos», no 0: un cero se leería como "la unidad no se movió",
      // que es más de lo que sabemos (ver leyenda).
      posiciones_gps_dia: f.posicionesGpsDia ?? 'sin datos',
    })));
  return `${encabezado}\n${tabla}`;
}
