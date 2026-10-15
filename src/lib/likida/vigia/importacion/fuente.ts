// ═══════════════════════════════════════════════════════════════════════════
// FUENTE DE TRACK & TRACE (T-A4-36): el CONTRATO, no el conector.
//
// El cliente tiene en Track & Trace un apartado de «control de unidad de Nuevo Laredo» (9df88631 ~17:26) donde se ve si
// una caja ya está en patio y si ya tiene sus documentos. BLOQUEO EXTERNO B11: todavía no hay acceso de lectura ni se
// conoce el formato real. Por eso aquí NO hay red, credenciales ni lectura real:
//
//   · `FuenteTrackAndTrace`  la interfaz que el conector real (T-A4-38) implementará.
//   · `SinEjecutor`          la implementación por omisión: FALLA CERRADO con un mensaje llano (nunca inventa datos).
//   · `crearFuenteDoble`     un doble para pruebas con registros sintéticos.
//   · `MAPA_UBICACION_TT` / `MAPA_DOCUMENTOS_TT` / `registroAEstatus`  el mapeo DECLARATIVO registro-T&T → estado.
//     Las etiquetas son SUPUESTOS sintéticos de contrato: cuando llegue el formato real (B11) solo cambian las tablas.
//   · `leerRegistrosTT`      valida una respuesta cruda: lo que no tiene la forma esperada se descarta y se cuenta.
// ═══════════════════════════════════════════════════════════════════════════
import type { DocsImportacion, EstadoImportacion, EstatusImportacion } from './modelo';

/** Un renglón del control de unidad, ya con la forma del contrato (los textos son los del sistema de origen). */
export interface RegistroTT {
  caja: string;
  unidad: string | null;
  /** Texto de ubicación/estatus del control de unidad. */
  ubicacion: string;
  /** Texto de documentos/requisitos del control de unidad. */
  documentos: string;
  /** Cuándo lo vio el sistema de origen (ISO 8601 con zona). */
  observadoEn: string;
}

export interface FuenteTrackAndTrace {
  leerControlUnidad(): Promise<RegistroTT[]>;
}

/** La fuente no está disponible (sin acceso, sin ejecutor). El mensaje es para una persona, no para un log. */
export class FuenteNoDisponibleError extends Error {
  readonly codigo = 'fuente_no_disponible';
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'FuenteNoDisponibleError';
  }
}

export const MENSAJE_SIN_EJECUTOR =
  'Track & Trace todavía no está conectado: falta el acceso de lectura al control de unidad. Mientras tanto el estatus se calcula con el programa de despacho.';

/** Fuente por omisión: falla cerrado, nunca devuelve datos inventados. */
export class SinEjecutor implements FuenteTrackAndTrace {
  async leerControlUnidad(): Promise<RegistroTT[]> {
    throw new FuenteNoDisponibleError(MENSAJE_SIN_EJECUTOR);
  }
}

/** Doble para pruebas: devuelve una copia de los registros dados. */
export function crearFuenteDoble(registros: readonly RegistroTT[]): FuenteTrackAndTrace {
  return {
    async leerControlUnidad() {
      return registros.map((r) => ({ ...r }));
    },
  };
}

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();

/** Ubicación de T&T → estado de la caja. SUPUESTOS de contrato (sintéticos) hasta conocer el formato real (B11). */
export const MAPA_UBICACION_TT: Readonly<Record<string, EstadoImportacion>> = {
  'EN PATIO': 'patio',
  'PENDIENTE DE CRUCE': 'pend_cruce',
  'EN RUTA': 'en_ruta',
};

/** Documentos de T&T → si la caja tiene sus documentos. SUPUESTOS de contrato (sintéticos) hasta conocer el formato real (B11). */
export const MAPA_DOCUMENTOS_TT: Readonly<Record<string, DocsImportacion>> = {
  LISTO: 'listo',
  'PENDIENTE DE REQUISITO': 'pend_requisito',
};

function buscar<T>(mapa: Readonly<Record<string, T>>, texto: string, porDefecto: T): T {
  const k = norm(texto);
  return Object.prototype.hasOwnProperty.call(mapa, k) ? mapa[k]! : porDefecto;
}

/** Registro de T&T → estatus de importación. Texto fuera del mapa → `desconocido` (nunca se adivina). */
export function registroAEstatus(r: RegistroTT): EstatusImportacion {
  return {
    caja: r.caja.trim(),
    unidad: r.unidad === null || r.unidad.trim() === '' ? null : r.unidad.trim(),
    estado: buscar(MAPA_UBICACION_TT, r.ubicacion, 'desconocido'),
    docs: buscar(MAPA_DOCUMENTOS_TT, r.documentos, 'desconocido'),
    fuente: 'track_trace',
    observadoEn: r.observadoEn,
    filaId: null,
  };
}

export interface ResultadoLecturaTT {
  registros: RegistroTT[];
  /** Cuántos elementos no tenían la forma del contrato y se descartaron. */
  descartados: number;
}

const esTexto = (v: unknown): v is string => typeof v === 'string';

/**
 * Valida una respuesta cruda de la fuente. Se exige: arreglo; `caja` con texto no vacío; `observadoEn` con fecha
 * ISO válida; `ubicacion` y `documentos` con texto (pueden estar vacíos); `unidad` texto o nula. Lo demás se descarta.
 * Si la respuesta ni siquiera es un arreglo, se falla cerrado con `FuenteNoDisponibleError`.
 */
export function leerRegistrosTT(crudo: unknown): ResultadoLecturaTT {
  if (!Array.isArray(crudo)) {
    throw new FuenteNoDisponibleError('Track & Trace respondió algo que no es una lista de unidades; no se usó.');
  }
  const registros: RegistroTT[] = [];
  let descartados = 0;
  for (const el of crudo as unknown[]) {
    const o = el !== null && typeof el === 'object' ? (el as Record<string, unknown>) : null;
    if (
      !o ||
      !esTexto(o.caja) ||
      o.caja.trim() === '' ||
      !esTexto(o.observadoEn) ||
      Number.isNaN(Date.parse(o.observadoEn)) ||
      !esTexto(o.ubicacion) ||
      !esTexto(o.documentos) ||
      !(o.unidad === null || o.unidad === undefined || esTexto(o.unidad))
    ) {
      descartados += 1;
      continue;
    }
    registros.push({
      caja: o.caja,
      unidad: o.unidad ?? null,
      ubicacion: o.ubicacion,
      documentos: o.documentos,
      observadoEn: o.observadoEn,
    });
  }
  return { registros, descartados };
}
