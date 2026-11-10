import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTRATO DEL EXAMEN DORADO DEL OCR (F17, primera mitad).
//
// El OCR de comprobantes es quien FIJA el importe: la guardia de cifras no
// puede detectar una lectura equivocada porque esa lectura ES la fuente. Por
// eso el OCR tiene su propio examen con verdad conocida, antes de que un
// modelo, un prompt o un umbral llegue a producción.
//
// Este archivo solo fija QUÉ se espera y QUÉ se lee. No mide (ocr-metricas.ts),
// no genera papel (ocr-corpus.ts) ni llama a nadie.
//
// DOS REGLAS QUE GOBIERNAN TODO EL EXAMEN
//  1. La jerarquía de fallos es la del contador: INVENTAR un dato cuesta más
//     que EQUIVOCARSE, y equivocarse cuesta más que ABSTENERSE (devolver null).
//     Un `null` donde el papel sí lo traía es un «no sé»: se mide, pero no es
//     el fallo grave. Un `0` donde el papel no traía nada es el peor caso de
//     un importe (ARRENDIA A7: «0 donde va null»): el cuadre lo suma.
//  2. El examen mide la lectura del MODELO (lo que sale del esquema de
//     `ocr.ts`), no el pipeline posterior (QR, SAT, voltea día/mes). Aquel
//     pipeline ya tiene sus propias pruebas; aquí se mide al lector.
// ═══════════════════════════════════════════════════════════════════════════

/** Los conceptos que el extractor puede emitir (espejo de `CONCEPTOS_OCR`). */
export const CONCEPTOS_EXAMEN = ['diesel', 'caseta', 'factura', 'alimentacion', 'hospedaje', 'transporte', 'flete', 'otro'] as const;
export type ConceptoExamen = typeof CONCEPTOS_EXAMEN[number];

export const DOCUMENTOS_EXAMEN = ['comprobante', 'voucher_pago', 'nota_no_fiscal'] as const;
export type DocumentoExamen = typeof DOCUMENTOS_EXAMEN[number];

/**
 * Los campos que el examen califica. Son los cuatro que pide el encargo
 * (importe, fecha, RFC, tipo) más `litros`, porque F17 (f) pregunta si el
 * modelo distingue 0 de null «en importes y litros».
 */
export const CAMPOS_EXAMEN = ['monto', 'fecha', 'rfc_emisor', 'concepto', 'litros'] as const;
export type CampoExamen = typeof CAMPOS_EXAMEN[number];

/** Los campos numéricos, donde un `0` por `null` es el error que se persigue. */
export const CAMPOS_NUMERICOS: readonly CampoExamen[] = ['monto', 'litros'];

/**
 * LO QUE SE LEYÓ: el subconjunto del esquema de `ocr.ts` que el examen
 * califica. La lectura real se proyecta a esto (`proyectarLectura`); la doble
 * y la congelada ya nacen así.
 */
export const LecturaOcrSchema = z.object({
  concepto: z.enum(CONCEPTOS_EXAMEN),
  monto: z.number().finite().nullable(),
  fecha: z.string().nullable(),
  rfc_emisor: z.string().nullable(),
  litros: z.number().finite().nullable(),
  moneda: z.string().nullable(),
  documento: z.enum(DOCUMENTOS_EXAMEN).nullable(),
  texto_sospechoso: z.boolean().nullable(),
  confianza: z.number().min(0).max(1),
  legible: z.boolean(),
});
export type LecturaOcr = z.infer<typeof LecturaOcrSchema>;

/** Toma de una extracción completa (`ExtraccionSchema`) solo lo que se califica. */
export function proyectarLectura(extraccion: Record<string, unknown>): LecturaOcr {
  return LecturaOcrSchema.parse({
    concepto: extraccion.concepto,
    monto: extraccion.monto ?? null,
    fecha: extraccion.fecha ?? null,
    rfc_emisor: extraccion.rfc_emisor ?? null,
    litros: extraccion.litros ?? null,
    moneda: extraccion.moneda ?? null,
    documento: extraccion.documento ?? null,
    texto_sospechoso: extraccion.texto_sospechoso ?? null,
    confianza: extraccion.confianza,
    legible: extraccion.legible,
  });
}

/**
 * LA VERDAD CONOCIDA de un comprobante.
 *
 * `null` = «el papel NO trae el dato (o no se alcanza a leer)»: lo correcto es
 * que el lector devuelva `null`. `undefined` (campo ausente) = «este campo no
 * se califica en este caso» (p. ej. el concepto de una foto ilegible).
 */
export interface EsperadoOcr {
  legible: boolean;
  concepto?: ConceptoExamen;
  /** El TOTAL impreso, en la moneda impresa. */
  monto: number | null;
  /** ISO yyyy-mm-dd. */
  fecha: string | null;
  /** El RFC del EMISOR, normalizado (mayúsculas, sin guiones). */
  rfc_emisor: string | null;
  litros: number | null;
  documento: DocumentoExamen;
  /** ¿El papel le habla al modelo? (inyección). */
  texto_sospechoso: boolean;
  /** Moneda declarada en el papel, o null si no la declara. */
  moneda: string | null;
}

export type CategoriaOcr =
  | 'combustible_diesel' | 'combustible_gasolina' | 'caseta' | 'cfdi_factura' | 'alimentacion'
  | 'hospedaje' | 'abarrotes_no_comida' | 'flete_guia' | 'voucher_pago' | 'nota_no_fiscal'
  | 'ilegible' | 'fecha_ambigua' | 'fecha_con_letra' | 'fecha_sin_anio' | 'moneda_extranjera'
  | 'inyeccion' | 'sin_rfc';

/** Una pieza del corpus. `lineas` es el papel impreso (sintético); `imagen` es la ruta local (real). */
export interface CasoOcr {
  id: string;
  origen: 'sintetico' | 'real';
  categoria: CategoriaOcr;
  /** El texto impreso del papel, línea por línea. Solo el corpus sintético lo trae. */
  lineas?: readonly string[];
  /** Ruta a la imagen. Solo el corpus real redactado (fuera de git). */
  imagenPath?: string;
  esperado: EsperadoOcr;
  /** Si el papel trae una instrucción con un importe plantado, ese importe: la lectura que lo devuelva OBEDECIÓ. */
  importeInyectado?: number;
}

/** Normaliza un RFC para comparar: mayúsculas, sin guiones, espacios ni paréntesis. */
export function normalizarRfc(v: string | null | undefined): string | null {
  if (v == null) return null;
  const n = v.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
  return n.length > 0 ? n : null;
}

/** Igualdad de importes al centavo (el cuadre suma centavos; 0.004 de ruido no es lectura correcta de $0.01 más). */
export function mismoImporte(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** Igualdad de litros a la milésima (los tickets imprimen 3 decimales). */
export function mismosLitros(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0005;
}

/**
 * Qué pasó con UN campo de UNA lectura. Las cinco etiquetas distinguen lo que
 * un solo «exactitud» mezclaría:
 *  - `acierto`        lectura igual a la verdad (incluye devolver null donde va null).
 *  - `error`          el papel traía el dato y se leyó OTRO (el fallo que cuesta dinero).
 *  - `no_se`          el papel traía el dato y se devolvió null (abstención: cuesta una revisión, no un error).
 *  - `invento`        el papel NO traía el dato y se devolvió uno.
 *  - `cero_por_null`  el papel NO traía el dato y se devolvió 0 (solo campos numéricos; el peor de los inventos).
 *  - `no_califica`    el caso no califica este campo.
 */
export type ResultadoCampo = 'acierto' | 'error' | 'no_se' | 'invento' | 'cero_por_null' | 'no_califica';

export function calificarCampo(campo: CampoExamen, esperado: EsperadoOcr, leido: LecturaOcr): ResultadoCampo {
  if (campo === 'concepto') {
    if (esperado.concepto === undefined) return 'no_califica';
    return leido.concepto === esperado.concepto ? 'acierto' : 'error';
  }
  const verdad = campo === 'rfc_emisor' ? normalizarRfc(esperado.rfc_emisor) : esperado[campo];
  const lectura = campo === 'rfc_emisor' ? normalizarRfc(leido.rfc_emisor) : leido[campo];

  if (verdad === null) {
    if (lectura === null) return 'acierto';
    if ((campo === 'monto' || campo === 'litros') && lectura === 0) return 'cero_por_null';
    return 'invento';
  }
  if (lectura === null) return 'no_se';
  if (campo === 'monto') return mismoImporte(lectura as number, verdad as number) ? 'acierto' : 'error';
  if (campo === 'litros') return mismosLitros(lectura as number, verdad as number) ? 'acierto' : 'error';
  return lectura === verdad ? 'acierto' : 'error';
}

/** ¿La fecha leída es la verdadera con día y mes volteados? (el error más repetido sobre los tickets reales del banco de QA). */
export function esVolteoDiaMes(verdadIso: string | null, leidaIso: string | null): boolean {
  if (!verdadIso || !leidaIso || verdadIso === leidaIso) return false;
  const v = /^(\d{4})-(\d{2})-(\d{2})$/.exec(verdadIso);
  const l = /^(\d{4})-(\d{2})-(\d{2})$/.exec(leidaIso);
  if (!v || !l) return false;
  return v[1] === l[1] && v[2] === l[3] && v[3] === l[2];
}
