// ═══════════════════════════════════════════════════════════════════════════
// ERRORES DEL TMS → HALLAZGOS DE LA BANDEJA (T-A3-29) — función PURA, sin base ni red.
//
// Qué resuelve (x3 §7.1; 33c4d51b 05:07): cuando el sistema del cliente rechaza la carga, el error NO se queda en un log:
// vuelve a la bandeja como hallazgos sobre los campos de Likida que hay que corregir, con palabras llanas. El TMS habla de
// celdas y columnas de SU plantilla; la persona de la oficina habla de «la fracción de la mercancía 1». Aquí se traduce con el
// layout INVERSO (`plantilla_tms.layout.ts`: hoja + fila + columna → campo del documento y renglón).
//
// ── LO ASUMIDO (bloqueo externo B-1) ────────────────────────────────────────
// El formato real de los errores de la carga NO existe todavía (la hoja `Error` del libro está vacía; los errores los
// muestra el módulo del TMS). Se asume el contrato del puerto: `errores[{hoja,fila,campo,detalle}]` (`ErrorFila`). Cuando PS
// entregue el formato real, solo cambia el adaptador del puerto o `resolver` aquí; los hallazgos y la bandeja no se enteran.
//
// ── SIN ECO DEL CONTENIDO ───────────────────────────────────────────────────
// El `detalle` del TMS puede traer el VALOR rechazado (un RFC, una descripción): no se copia a ningún hallazgo, ni a la
// bitácora, ni a la base. Solo se usa para CLASIFICAR la razón (catálogo / obligatorio / formato) con palabras nuestras.
// Lo que sí viaja es la UBICACIÓN (hoja, fila, nombre de columna) y el `mensajeLlano` del puerto, acotado.
//
// ── QUÉ NO SE TRADUCE ───────────────────────────────────────────────────────
// Un error que no cae en ninguna celda ni columna del layout (o cuyo renglón no existe) no se adivina: se junta en UN hallazgo
// genérico «El sistema del cliente rechazó el archivo: <mensaje>». Todos los hallazgos son BLOQUEO: no se reaprueba sin corregir.
// ═══════════════════════════════════════════════════════════════════════════

import { campoDoc, campoMercancia, etiquetaCampo } from './campos';
import { LAYOUT_NORMAL, type HojaLayout, type LayoutPlantilla } from './plantilla_tms.layout';
import type { ErrorFila } from './tms_puerto';
import type { Hallazgo } from './validacion';

export const CODIGO_TMS_RECHAZO = 'tms_rechazo';
export const CODIGO_TMS_REPETIDO = 'tms_rechazo_repetido';
/** Tope de ubicaciones que se anotan en la bitácora y de hallazgos que se levantan de UN rechazo. */
export const TOPE_UBICACIONES = 30;
const TOPE_MENSAJE = 200;
const TOPE_TEXTO = 80;

export type RazonTms = 'catalogo' | 'obligatorio' | 'formato' | 'otra';

const FRASE: Record<RazonTms, string> = {
  catalogo: 'no está en el catálogo del sistema del cliente',
  obligatorio: 'es obligatorio y falta',
  formato: 'no tiene el formato que pide',
  otra: 'no fue aceptado',
};

/** Clasifica el texto del TMS en una razón nuestra. El texto original NO se conserva. */
export function razonDe(detalle: string | undefined): RazonTms {
  const t = detalle ?? '';
  if (/cat[aá]logo|no existe|inexistente|no encontrad|desconocid/i.test(t)) return 'catalogo';
  if (/obligatori|requerid|vac[ií]o|falta|nulo/i.test(t)) return 'obligatorio';
  if (/formato|inv[aá]lid|no num[eé]ric|longitud|caracter|debe ser|decimal/i.test(t)) return 'formato';
  return 'otra';
}

const norm = (s: string | undefined): string => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const limpio = (s: string | undefined, tope: number): string => (s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, tope);

export interface Ubicacion { campo: string; renglon: number | null }

/** Una columna de la tabla cuyo encabezado (o letra) coincide con `campo`; en duda (varias), ninguna: no se adivina. */
function columnaDe(tb: HojaLayout['tablas'][number], campo: string | undefined): (typeof tb.columnas)[number] | null {
  const buscado = norm(campo);
  if (!buscado) return null;
  const letra = (campo ?? '').trim().toUpperCase();
  const conCampo = tb.columnas.filter((c) => c.campo !== undefined);
  const exacta = conCampo.filter((c) => norm(c.encabezado) === buscado || c.columna === letra);
  if (exacta.length === 1) return exacta[0];
  if (exacta.length > 1 || buscado.length < 4) return null;
  const parecidas = conCampo.filter((c) => { const e = norm(c.encabezado); return e.length >= 4 && (e.includes(buscado) || buscado.includes(e)); });
  return parecidas.length === 1 ? parecidas[0] : null;
}

/** El campo del documento que alimenta `clave` del layout (`ctx.clienteInterno` es un dato del sistema, no de la plantilla del cliente). */
function claveDocumento(clave: string): string {
  return clave === 'ctx.clienteInterno' ? 'numero_cliente_interno' : clave;
}

/** Hoja + fila + campo del TMS → campo de Likida y renglón. `null` = no se puede ubicar. */
export function ubicar(e: ErrorFila, layout: LayoutPlantilla, nMercancias: number | null): Ubicacion | null {
  const hojas = e.hoja ? layout.hojas.filter((h) => norm(h.hoja) === norm(e.hoja)) : layout.hojas;
  for (const h of hojas) {
    for (const tb of h.tablas) {
      const col = columnaDe(tb, e.campo);
      if (!col || col.campo === undefined) continue;
      if (tb.id === 'mercancias') {
        if (e.fila === undefined || e.fila < tb.primeraFila || e.fila >= tb.primeraFila + tb.maxFilas) continue;
        const renglon = e.fila - tb.primeraFila;
        const clave = col.campo.replace(/^mercancia\./, '');
        if (!campoMercancia(clave) || (nMercancias !== null && renglon >= nMercancias)) continue;
        return { campo: clave, renglon };
      }
      // Tabla de destinos: un solo destino por documento; sus columnas son campos del documento.
      if (e.fila !== undefined && (e.fila < tb.primeraFila || e.fila >= tb.primeraFila + tb.maxFilas)) continue;
      const clave = claveDocumento(col.campo);
      if (campoDoc(clave)) return { campo: clave, renglon: null };
    }
    // Celdas fijas: los valores van en una columna; la FILA identifica la celda (o `campo` trae la coordenada, p. ej. `C12`).
    const coord = /^[A-Za-z]{1,2}\d+$/.test((e.campo ?? '').trim()) ? (e.campo as string).trim().toUpperCase() : null;
    const celdas = h.celdas.filter((c) => (coord !== null ? c.celda === coord : e.fila !== undefined && Number(c.celda.replace(/^[A-Z]+/, '')) === e.fila));
    for (const c of celdas) {
      const clave = claveDocumento(c.campo);
      if (campoDoc(clave)) return { campo: clave, renglon: null };
    }
  }
  return null;
}

export interface OpcionesTraduccion {
  layout?: LayoutPlantilla;
  /** Cuántos renglones de mercancía tiene el documento (un error en un renglón que no existe no se ubica). */
  mercancias?: number | null;
  /** El `mensajeLlano` del puerto, para el hallazgo genérico. */
  mensajeLlano?: string;
}

export interface TraduccionTms {
  hallazgos: Hallazgo[];
  mapeados: number;
  sinMapeo: number;
  /** `hoja!fila!columna` de cada error (sin detalle ni valores), acotado: lo que va a la bitácora. */
  ubicaciones: string[];
}

/**
 * Los errores de una carga rechazada → hallazgos `bloqueo` con `origen: 'tms'`, uno por (campo, renglón), más uno genérico si
 * algún error no se pudo ubicar (o si el TMS no dijo cuáles). Nunca devuelve una lista vacía: un rechazo siempre deja rastro.
 */
export function traducirErroresTms(errores: ReadonlyArray<ErrorFila>, opciones: OpcionesTraduccion = {}): TraduccionTms {
  const layout = opciones.layout ?? LAYOUT_NORMAL;
  const n = opciones.mercancias ?? null;
  const porCampo = new Map<string, { u: Ubicacion; razones: Set<RazonTms> }>();
  let sinMapeo = 0;
  const ubicaciones: string[] = [];

  for (const e of errores) {
    if (ubicaciones.length < TOPE_UBICACIONES) {
      ubicaciones.push([limpio(e.hoja, TOPE_TEXTO), e.fila ?? '', limpio(e.campo, TOPE_TEXTO)].join('!'));
    }
    const u = ubicar(e, layout, n);
    if (!u) { sinMapeo++; continue; }
    const llave = `${u.campo}|${u.renglon ?? ''}`;
    const previo = porCampo.get(llave);
    if (previo) previo.razones.add(razonDe(e.detalle));
    else porCampo.set(llave, { u, razones: new Set([razonDe(e.detalle)]) });
  }

  const hallazgos: Hallazgo[] = [];
  for (const { u, razones } of porCampo.values()) {
    if (hallazgos.length >= TOPE_UBICACIONES) { sinMapeo++; continue; }
    // `otra` solo se nombra si no hay una razón más concreta.
    const concretas = [...razones].filter((r) => r !== 'otra');
    const frases = (concretas.length > 0 ? concretas : (['otra'] as RazonTms[])).map((r) => FRASE[r]);
    hallazgos.push({
      campo: u.campo, renglon: u.renglon, severidad: 'bloqueo', codigo: CODIGO_TMS_RECHAZO, origen: 'tms',
      mensaje: `${etiquetaCampo(u.campo, u.renglon)}: el sistema del cliente lo rechazó (${frases.join('; ')}). Corrígelo y vuelve a aprobar.`,
    });
  }
  const mapeados = hallazgos.length;

  if (sinMapeo > 0 || errores.length === 0) hallazgos.push(hallazgoGenerico(opciones.mensajeLlano));
  return { hallazgos, mapeados, sinMapeo, ubicaciones };
}

/** «El sistema del cliente rechazó el archivo: …» — el hallazgo cuando no se sabe qué campo. El mensaje lo escribe el puerto, no el cliente. */
export function hallazgoGenerico(mensajeLlano: string | undefined): Hallazgo {
  const m = limpio(mensajeLlano, TOPE_MENSAJE).replace(/[.\s]+$/, '');
  return {
    campo: 'documento', renglon: null, severidad: 'bloqueo', codigo: CODIGO_TMS_RECHAZO, origen: 'tms',
    mensaje: `El sistema del cliente rechazó el archivo: ${m || 'no dijo el motivo'}.`,
  };
}

/** Lo que se le dice a la persona cuando el contenido que se iba a mandar es idéntico al que el TMS ya rechazó. */
export function hallazgoRepetido(): Hallazgo {
  return {
    campo: 'documento', renglon: null, severidad: 'bloqueo', codigo: CODIGO_TMS_REPETIDO, origen: 'tms',
    mensaje: 'El sistema del cliente ya rechazó este mismo contenido: corrige el documento antes de volver a aprobarlo (no se reenvía igual).',
  };
}
