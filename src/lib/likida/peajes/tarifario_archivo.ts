import { normalizarNombre, fechaHoraDeCelda, montoDeCelda, type Celda } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// EL TARIFARIO — lectura del archivo y reglas de guardado (T-A2-06).
//
// Un tarifario es «cuánto cuesta cruzar ESTA caseta con ESTA clase de vehículo,
// desde y hasta cuándo». El archivo que lo trae (CSV o Excel):
//
//   caseta;clase;importe;desde;hasta
//   Caseta Ejemplo Norte;5;300,00;2026-01-01;2026-06-30
//
// Este módulo es PURO: valida cada fila, rechaza con motivo en lenguaje llano y
// decide qué pasa al guardar una tarifa (crear, actualizar o rechazar por traslape)
// con la regla de confirmación: NINGUNA tarifa nace confirmada salvo una carga
// marcada «proveedor»; confirmar es una acción humana (`datos.ts`). El I/O vive allá.
// ═══════════════════════════════════════════════════════════════════════════

export type OrigenTarifa = 'declarada' | 'inferida' | 'proveedor';
export const ORIGENES_TARIFA: readonly OrigenTarifa[] = ['declarada', 'inferida', 'proveedor'];

export const TOPE_TARIFAS_IMPORTACION = 5_000;
export const CLASE_MIN = 1;
export const CLASE_MAX = 99;
export const IMPORTE_MAX = 1_000_000;

/** Lo que el llamador propone guardar: sin id, sin confirmación (eso lo decide la regla). */
export interface TarifaEntrada {
  /** El nombre como lo escribió la persona o el archivo; se normaliza aquí. */
  caseta: string;
  clase: number;
  importe: number;
  /** «aaaa-mm-dd» (día de México). */
  vigenteDesde: string;
  /** «aaaa-mm-dd» o null = sin fin. */
  vigenteHasta: string | null;
}

export interface TarifaImportada extends TarifaEntrada {
  fila: number;
  casetaNorm: string;
}

export interface LecturaTarifas {
  tarifas: TarifaImportada[];
  rechazadas: Array<{ fila: number; motivo: string }>;
  error?: string;
}

/** Una tarifa ya guardada (o ya aceptada en este mismo archivo). */
export interface TarifaExistente {
  id?: string;
  casetaNorm: string;
  clase: number;
  importe: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
  origen: OrigenTarifa;
  confirmada: boolean;
  confirmadaPor: string | null;
}

const COLS: Record<'caseta' | 'clase' | 'importe' | 'desde' | 'hasta', string[]> = {
  caseta: ['caseta', 'nombre', 'plaza', 'nombre de la caseta', 'nombre de la plaza'],
  clase: ['clase', 'categoria', 'clase de vehiculo', 'tipo de vehiculo'],
  importe: ['importe', 'tarifa', 'costo', 'monto', 'precio', 'tarifa mxn'],
  desde: ['desde', 'vigente desde', 'vigencia desde', 'inicio', 'inicio de vigencia', 'fecha inicio'],
  hasta: ['hasta', 'vigente hasta', 'vigencia hasta', 'fin', 'fin de vigencia', 'fecha fin'],
};

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Clase entera entre 1 y 99 desde una celda («5», 5, «5.0»), o null. */
export function claseDeCelda(v: Celda): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n >= CLASE_MIN && n <= CLASE_MAX ? n : null;
}

/** Dos vigencias [desde, hasta] (hasta null = sin fin), extremos incluidos, ¿comparten algún día? */
export function vigenciasSeTraslapan(
  a: { vigenteDesde: string; vigenteHasta: string | null },
  b: { vigenteDesde: string; vigenteHasta: string | null },
): boolean {
  // aaaa-mm-dd se ordena como texto.
  const aTerminaAntes = a.vigenteHasta !== null && a.vigenteHasta < b.vigenteDesde;
  const bTerminaAntes = b.vigenteHasta !== null && b.vigenteHasta < a.vigenteDesde;
  return !aTerminaAntes && !bTerminaAntes;
}

const textoVigencia = (t: { vigenteDesde: string; vigenteHasta: string | null }) =>
  `del ${t.vigenteDesde} ${t.vigenteHasta ? `al ${t.vigenteHasta}` : 'sin fecha de fin'}`;

/** El motivo (en lenguaje llano) por el que la entrada no sirve, o null si es válida. */
export function validarTarifaEntrada(e: TarifaEntrada): string | null {
  const norm = normalizarNombre(e.caseta);
  if (!norm) return 'falta el nombre de la caseta';
  if (norm.length > 120) return 'el nombre de la caseta pasa de 120 caracteres';
  if (!Number.isInteger(e.clase) || e.clase < CLASE_MIN || e.clase > CLASE_MAX) {
    return `la clase debe ser un número entero de ${CLASE_MIN} a ${CLASE_MAX}`;
  }
  if (!Number.isFinite(e.importe)) return 'el importe no es un número';
  if (e.importe < 0) return 'el importe no puede ser negativo';
  if (e.importe > IMPORTE_MAX) return `el importe pasa de ${IMPORTE_MAX.toLocaleString('en-US')} pesos: revisa que sea una tarifa y no un total`;
  if (!FECHA_ISO.test(e.vigenteDesde)) return 'la fecha de inicio de vigencia no es válida (aaaa-mm-dd)';
  if (e.vigenteHasta !== null) {
    if (!FECHA_ISO.test(e.vigenteHasta)) return 'la fecha de fin de vigencia no es válida (aaaa-mm-dd)';
    if (e.vigenteHasta < e.vigenteDesde) return 'la vigencia termina antes de empezar';
  }
  return null;
}

export function parsearTarifasMatriz(matriz: Celda[][], opciones: { desdePorDefecto?: string } = {}): LecturaTarifas {
  const vacio: LecturaTarifas = { tarifas: [], rechazadas: [] };
  if (matriz.length === 0) return { ...vacio, error: 'El archivo está vacío.' };

  const enc = matriz[0].map(normalizarNombre);
  const idx: Partial<Record<keyof typeof COLS, number>> = {};
  for (const k of Object.keys(COLS) as Array<keyof typeof COLS>) {
    const i = enc.findIndex((e) => COLS[k].includes(e));
    if (i >= 0) idx[k] = i;
  }
  const faltan = (['caseta', 'clase', 'importe'] as const).filter((k) => idx[k] === undefined);
  if (faltan.length > 0) {
    return {
      ...vacio,
      error: `Faltan columnas: ${faltan.join(', ')}. Encabezados leídos: ${matriz[0].map((c) => `«${String(c ?? '').trim()}»`).join(', ')}. `
        + 'El archivo necesita: caseta, clase e importe (y opcionales desde y hasta, con la vigencia).',
    };
  }
  if (idx.desde === undefined && !opciones.desdePorDefecto) {
    return { ...vacio, error: 'Falta la columna «desde» (inicio de vigencia) y no se indicó una fecha de inicio para todo el archivo.' };
  }
  if (matriz.length - 1 > TOPE_TARIFAS_IMPORTACION) {
    return { ...vacio, error: `El archivo trae más de ${TOPE_TARIFAS_IMPORTACION} tarifas. Pártelo y súbelo en partes.` };
  }

  const tarifas: TarifaImportada[] = [];
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  // Lo ya aceptado, por (caseta, clase): contra esto se detecta lo repetido y lo traslapado dentro del archivo.
  const aceptadas = new Map<string, TarifaImportada[]>();

  for (let f = 1; f < matriz.length; f++) {
    const fila = matriz[f];
    if (!fila || fila.every((c) => String(c ?? '').trim() === '')) continue;
    const n = f + 1; // fila 1-based como la ve el usuario en su Excel
    const celda = (k: keyof typeof COLS) => (idx[k] === undefined ? undefined : fila[idx[k] as number]);
    const rechazar = (motivo: string) => { rechazadas.push({ fila: n, motivo }); };

    const caseta = String(celda('caseta') ?? '').trim().replace(/\s+/g, ' ');
    const clase = claseDeCelda(celda('clase'));
    if (clase === null) { rechazar(`la clase no es un número entero de ${CLASE_MIN} a ${CLASE_MAX}`); continue; }
    const importe = montoDeCelda(celda('importe'));
    if (importe === null) { rechazar('el importe está vacío o no se puede leer'); continue; }

    const crudoDesde = celda('desde');
    let vigenteDesde = opciones.desdePorDefecto ?? '';
    if (crudoDesde !== undefined && String(crudoDesde).trim() !== '') {
      const d = fechaHoraDeCelda(crudoDesde).fecha;
      if (!d) { rechazar('la fecha de inicio de vigencia no se puede leer'); continue; }
      vigenteDesde = d;
    } else if (!vigenteDesde) {
      rechazar('falta la fecha de inicio de vigencia'); continue;
    }
    const crudoHasta = celda('hasta');
    let vigenteHasta: string | null = null;
    if (crudoHasta !== undefined && String(crudoHasta).trim() !== '') {
      vigenteHasta = fechaHoraDeCelda(crudoHasta).fecha;
      if (!vigenteHasta) { rechazar('la fecha de fin de vigencia no se puede leer'); continue; }
    }

    const entrada: TarifaEntrada = { caseta, clase, importe, vigenteDesde, vigenteHasta };
    const motivo = validarTarifaEntrada(entrada);
    if (motivo) { rechazar(motivo); continue; }

    const casetaNorm = normalizarNombre(caseta);
    const llave = `${casetaNorm}|${clase}`;
    const previas = aceptadas.get(llave) ?? [];
    const igual = previas.find((p) => p.vigenteDesde === vigenteDesde);
    if (igual) { rechazar(`repetida: ya estaba en la fila ${igual.fila} (misma caseta, clase e inicio de vigencia)`); continue; }
    const choca = previas.find((p) => vigenciasSeTraslapan(p, entrada));
    if (choca) { rechazar(`la vigencia (${textoVigencia(entrada)}) se traslapa con la de la fila ${choca.fila} (${textoVigencia(choca)})`); continue; }

    const t: TarifaImportada = { ...entrada, fila: n, casetaNorm };
    aceptadas.set(llave, [...previas, t]);
    tarifas.push(t);
  }
  return { tarifas, rechazadas };
}

// ── Qué hacer al guardar una tarifa ─────────────────────────────────────────

export type PlanTarifa =
  | { tipo: 'rechazada'; motivo: string }
  /** `fila` es la fila completa a escribir (con la confirmación ya decidida). */
  | { tipo: 'crear' | 'actualizar' | 'igual'; fila: TarifaExistente };

/**
 * Decide qué hacer con una tarifa nueva frente a las ya guardadas de la flota.
 *
 *  · Misma llave (caseta, clase, inicio de vigencia) → ACTUALIZA esa fila.
 *  · Otra vigencia de la misma caseta y clase que comparta algún día → RECHAZA.
 *  · Si la fila existente estaba confirmada y el importe NO cambia, la confirmación y su
 *    procedencia se conservan (solo puede cambiar el fin de vigencia): volver a subir el
 *    mismo archivo no destruye el trabajo de quien confirmó.
 *  · Si el importe cambia, la confirmación se pierde: confirmó OTRO número.
 *  · Una fila nueva (o con importe cambiado) solo nace confirmada si la carga es 'proveedor', y entonces EXIGE el nombre de
 *    quien confirma (A37-A2-26): sin él se rechaza, porque «confirmada» sin responsable alimenta un «indebido confirmado» sin dueño.
 */
export function planificarTarifa(existentes: readonly TarifaExistente[], entrada: TarifaEntrada, origen: OrigenTarifa, quienConfirma: string | null = null): PlanTarifa {
  const motivo = validarTarifaEntrada(entrada);
  if (motivo) return { tipo: 'rechazada', motivo };
  if (!ORIGENES_TARIFA.includes(origen)) return { tipo: 'rechazada', motivo: 'el origen de la tarifa no es válido' };

  const casetaNorm = normalizarNombre(entrada.caseta);
  const importe = Math.round(entrada.importe * 100) / 100;
  const mismas = existentes.filter((t) => t.casetaNorm === casetaNorm && t.clase === entrada.clase);
  const previa = mismas.find((t) => t.vigenteDesde === entrada.vigenteDesde);
  const choca = mismas.find((t) => t !== previa && vigenciasSeTraslapan(t, entrada));
  if (choca) {
    return { tipo: 'rechazada', motivo: `la vigencia (${textoVigencia(entrada)}) se traslapa con una tarifa ya guardada (${textoVigencia(choca)})` };
  }

  const base = { id: previa?.id, casetaNorm, clase: entrada.clase, vigenteDesde: entrada.vigenteDesde, vigenteHasta: entrada.vigenteHasta };
  if (previa && previa.confirmada && previa.importe === importe) {
    const fila: TarifaExistente = { ...previa, vigenteHasta: entrada.vigenteHasta };
    return { tipo: previa.vigenteHasta === entrada.vigenteHasta ? 'igual' : 'actualizar', fila };
  }
  const confirmada = origen === 'proveedor';
  const confirmadaPor = confirmada ? (quienConfirma?.trim().replace(/\s+/g, ' ').slice(0, 120) || null) : null;
  if (confirmada && !confirmadaPor) return { tipo: 'rechazada', motivo: 'una tarifa con origen «proveedor» nace confirmada: indica quién la confirma' };
  const fila: TarifaExistente = { ...base, importe, origen, confirmada, confirmadaPor };
  if (previa) {
    const sinCambio = previa.importe === importe && previa.vigenteHasta === entrada.vigenteHasta && previa.origen === origen && previa.confirmada === confirmada && previa.confirmadaPor === confirmadaPor;
    return { tipo: sinCambio ? 'igual' : 'actualizar', fila };
  }
  return { tipo: 'crear', fila };
}
