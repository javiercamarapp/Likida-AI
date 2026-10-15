import { normalizarNombre } from './formatos';
import { CLASES_VALIDAS_DEFAULT } from './reglas_cobro';
import type { TarifaExistente } from './tarifario_archivo';
import type { TarifaInferida } from './tarifario_inferido';

// ═══════════════════════════════════════════════════════════════════════════
// PROMOCIÓN CANDIDATO → COBRO CON MONTO RECLAMABLE (T-A2-08).
//
// Módulo PURO (sin base, sin red) que SE SUMA a `reglas_cobro.ts` sin tocarlo:
// compara cada línea (o candidato) con la tarifa vigente de su caseta y clase
// ESPERADA y calcula cuánto se podría reclamar.
//
// Honestidad (guardia central): una línea solo se rotula «cobro indebido
// confirmado» si existe una tarifa CONFIRMADA por una persona o el proveedor y
// el exceso supera la tolerancia. Con tarifa inferida sigue siendo candidato;
// sin tarifa no hay veredicto. Los textos nunca afirman «indebido» fuera del
// estado confirmado.
//
// Clase esperada de cada línea:
//   1. unidad sin caja (configuración) → 3;
//   2. si no, la clase registrada cuando es válida (3/5 o excepción de la caseta);
//   3. si no, `claseEsperadaDefault` (5).
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoTarifa =
  | 'cobro_indebido_confirmado'
  | 'candidato_con_tarifa_inferida'
  | 'dentro_de_tarifa'
  | 'sin_tarifa';

/** Categoría nueva: cobro más caro que la tarifa vigente en su misma clase. */
export type CategoriaTarifa = 'importe_sobre_tarifa';

export const ETIQUETA_CATEGORIA_TARIFA: Record<CategoriaTarifa, string> = {
  importe_sobre_tarifa: 'Importe mayor que la tarifa',
};

export const ETIQUETA_ESTADO_TARIFA: Record<EstadoTarifa, string> = {
  cobro_indebido_confirmado: 'Cobro indebido (tarifa confirmada)',
  candidato_con_tarifa_inferida: 'Candidato (tarifa inferida, por confirmar)',
  dentro_de_tarifa: 'Dentro de la tarifa',
  sin_tarifa: 'Sin tarifa para comparar',
};

export interface LineaParaTarifa {
  indice: number;
  fecha: string | null;
  caseta: string | null;
  unidad?: string | null;
  clase?: number | null;
  monto: number;
}

export interface OpcionesTarifa {
  /** Pesos de diferencia que se toleran antes de hablar de exceso. Default 1. */
  toleranciaPesos?: number;
  /** Clase esperada cuando la registrada no es válida. Default 5. */
  claseEsperadaDefault?: number;
  /** Clase esperada para unidades sin caja. Default 3. */
  claseSinCaja?: number;
  /** Unidades (normalizadas con `normalizarNombre`) que circulan sin caja. */
  unidadesSinCaja?: ReadonlySet<string>;
  /** Clases válidas en toda caseta. Default {3, 5}. */
  clasesValidas?: readonly number[];
  /** Clases adicionales válidas por caseta (llave: nombre normalizado). */
  excepcionesClase?: ReadonlyMap<string, readonly number[]>;
}

export interface EvaluacionTarifa {
  claseEsperada: number;
  /** null si no hay tarifa vigente para (caseta, claseEsperada) en la fecha de la línea. */
  importeEsperado: number | null;
  /** max(0, importe − esperado), a centavos; 0 si no hay tarifa. */
  montoReclamable: number;
  estadoTarifa: EstadoTarifa;
  /** Solo 'importe_sobre_tarifa' cuando el exceso supera la tolerancia en la clase registrada válida. */
  categoriaTarifa: CategoriaTarifa | null;
  /** Origen de la tarifa usada. */
  tarifaOrigen: 'confirmada' | 'inferida' | null;
  quePasoTarifa: string;
  queSignificaTarifa: string;
  queHacerTarifa: string;
}

export type LineaEvaluada<L extends LineaParaTarifa> = L & EvaluacionTarifa;

export interface ResumenTarifa {
  /** Suma del exceso en líneas con tarifa CONFIRMADA y exceso sobre la tolerancia. */
  montoConfirmado: number;
  /** Suma del exceso en líneas con tarifa INFERIDA (no confirmado). */
  montoNoConfirmado: number;
  nConfirmados: number;
  nCandidatos: number;
  nSinTarifa: number;
  nDentro: number;
}

const centavos = (n: number): number => Math.round((n + Number.EPSILON) * 100);
const pesos = (c: number): number => c / 100;
const dinero = (n: number): string => `$${n.toFixed(2)}`;

/** Adapta tarifas inferidas (sin vigencia) al formato de tarifas guardadas, siempre SIN confirmar. */
export function tarifasDesdeInferidas(inferidas: readonly TarifaInferida[]): TarifaExistente[] {
  return inferidas.map((t) => ({
    casetaNorm: t.casetaNorm, clase: t.clase, importe: t.importe,
    vigenteDesde: '0001-01-01', vigenteHasta: null,
    origen: 'inferida', confirmada: false, confirmadaPor: null,
  }));
}

function vigente(t: TarifaExistente, fecha: string | null): boolean {
  if (fecha === null) return t.vigenteHasta === null;
  return t.vigenteDesde <= fecha && (t.vigenteHasta === null || fecha <= t.vigenteHasta);
}

/** Tarifa vigente: prefiere confirmada y, entre iguales, la de vigencia más reciente; determinista. */
function buscarTarifa(tarifas: readonly TarifaExistente[], casetaNorm: string, clase: number, fecha: string | null): TarifaExistente | null {
  let mejor: TarifaExistente | null = null;
  for (const t of tarifas) {
    if (t.casetaNorm !== casetaNorm || t.clase !== clase || !vigente(t, fecha)) continue;
    if (mejor === null
      || (t.confirmada && !mejor.confirmada)
      || (t.confirmada === mejor.confirmada && (t.vigenteDesde > mejor.vigenteDesde
        || (t.vigenteDesde === mejor.vigenteDesde && t.importe < mejor.importe)))) mejor = t;
  }
  return mejor;
}

export function evaluarContraTarifa<L extends LineaParaTarifa>(
  lineas: readonly L[],
  tarifas: readonly TarifaExistente[],
  opciones: OpcionesTarifa = {},
): Array<LineaEvaluada<L>> {
  const tolC = centavos(opciones.toleranciaPesos ?? 1);
  const claseDefault = opciones.claseEsperadaDefault ?? 5;
  const claseSinCaja = opciones.claseSinCaja ?? 3;
  const validasBase = opciones.clasesValidas ?? CLASES_VALIDAS_DEFAULT;

  return lineas.map((l): LineaEvaluada<L> => {
    const casetaNorm = l.caseta === null || l.caseta === undefined ? '' : normalizarNombre(l.caseta);
    const unidadNorm = l.unidad === null || l.unidad === undefined ? '' : normalizarNombre(l.unidad);
    const validas = new Set<number>([...validasBase, ...(opciones.excepcionesClase?.get(casetaNorm) ?? [])]);
    const registradaValida = l.clase !== null && l.clase !== undefined && validas.has(l.clase);
    const sinCaja = unidadNorm !== '' && opciones.unidadesSinCaja?.has(unidadNorm) === true;
    const claseEsperada = sinCaja ? claseSinCaja : registradaValida ? (l.clase as number) : claseDefault;

    const tarifa = casetaNorm === '' ? null : buscarTarifa(tarifas, casetaNorm, claseEsperada, l.fecha);
    const montoC = centavos(l.monto);

    if (tarifa === null) {
      return {
        ...l, claseEsperada, importeEsperado: null, montoReclamable: 0, estadoTarifa: 'sin_tarifa',
        categoriaTarifa: null, tarifaOrigen: null,
        quePasoTarifa: `No hay una tarifa vigente de clase ${claseEsperada} para esta caseta en la fecha del cruce.`,
        queSignificaTarifa: 'Sin tarifa no se puede decir si el cobro es correcto: sigue siendo solo un candidato a revisar.',
        queHacerTarifa: 'Pide o captura la tarifa de esta caseta; mientras tanto no reclames por importe.',
      };
    }

    const esperadoC = centavos(tarifa.importe);
    const excesoC = Math.max(0, montoC - esperadoC);
    const sobre = excesoC > tolC;
    const confirmada = tarifa.confirmada;
    const rotulo = confirmada ? 'confirmada' : 'inferida';
    const rotuloLargo = confirmada ? 'tarifa confirmada' : 'tarifa inferida de tus archivos, aún por confirmar';

    const estadoTarifa: EstadoTarifa = !sobre ? 'dentro_de_tarifa' : confirmada ? 'cobro_indebido_confirmado' : 'candidato_con_tarifa_inferida';
    const categoriaTarifa: CategoriaTarifa | null = sobre && registradaValida && l.clase === claseEsperada ? 'importe_sobre_tarifa' : null;

    let quePasoTarifa: string;
    let queSignificaTarifa: string;
    let queHacerTarifa: string;
    if (!sobre) {
      quePasoTarifa = `Se cobraron ${dinero(pesos(montoC))} y la tarifa ${rotulo} de clase ${claseEsperada} es ${dinero(pesos(esperadoC))}.`;
      queSignificaTarifa = 'El importe no supera la tarifa (dentro de la tolerancia): no hay monto que reclamar por importe.';
      queHacerTarifa = 'Nada que hacer por este concepto.';
    } else if (confirmada) {
      quePasoTarifa = `Se cobraron ${dinero(pesos(montoC))} y la tarifa confirmada de clase ${claseEsperada} es ${dinero(pesos(esperadoC))}: ${dinero(pesos(excesoC))} de más.`;
      queSignificaTarifa = `Con ${rotuloLargo}, esa diferencia es un cobro indebido que se puede reclamar.`;
      queHacerTarifa = `Incluye esta línea en el reclamo al proveedor por ${dinero(pesos(excesoC))}.`;
    } else {
      quePasoTarifa = `Se cobraron ${dinero(pesos(montoC))} y la tarifa de clase ${claseEsperada} (${rotuloLargo}) es ${dinero(pesos(esperadoC))}: ${dinero(pesos(excesoC))} de más.`;
      queSignificaTarifa = 'Todavía es un candidato: la tarifa sale de tus propios archivos y nadie la ha confirmado, así que no se puede afirmar que el cobro sea incorrecto.';
      queHacerTarifa = 'Confirma la tarifa de esta caseta (con el proveedor o con finanzas); si se confirma, este monto pasa a ser reclamable.';
    }

    return {
      ...l, claseEsperada, importeEsperado: pesos(esperadoC), montoReclamable: pesos(excesoC), estadoTarifa,
      categoriaTarifa, tarifaOrigen: rotulo, quePasoTarifa, queSignificaTarifa, queHacerTarifa,
    };
  });
}

/** Totales del reclamo: lo confirmado y lo NO confirmado van siempre separados. */
export function resumirTarifa(evaluadas: ReadonlyArray<EvaluacionTarifa>): ResumenTarifa {
  let conf = 0, noConf = 0, nConf = 0, nCand = 0, nSin = 0, nDentro = 0;
  for (const e of evaluadas) {
    switch (e.estadoTarifa) {
      case 'cobro_indebido_confirmado': conf += centavos(e.montoReclamable); nConf++; break;
      case 'candidato_con_tarifa_inferida': noConf += centavos(e.montoReclamable); nCand++; break;
      case 'sin_tarifa': nSin++; break;
      default: nDentro++;
    }
  }
  return { montoConfirmado: pesos(conf), montoNoConfirmado: pesos(noConf), nConfirmados: nConf, nCandidatos: nCand, nSinTarifa: nSin, nDentro };
}
