// ═══════════════════════════════════════════════════════════════════════════
// ÍNDICE DE NORMAS — la única lista de lo que el producto puede citar.
//
// Existe para `guardiaFundamento()`: el modelo solo puede referenciar una norma
// que una tool le devolvió EN ESE TURNO, y el servidor sustituye el texto. Sin
// un índice cerrado, "no alucina el artículo" es una esperanza sobre el prompt;
// con él es una propiedad del código.
//
// LA FUENTE DE VERDAD SIGUEN SIENDO LAS FICHAS de `normas/*.yaml`, que traen el
// texto vigente transcrito y la trazabilidad de verificación. Esto es un índice
// compacto para runtime —serverless no debería parsear 17 YAML por invocación—
// y `normas_sincronizadas.test.ts` falla si se separan.
//
// `jerarquia` NO es decorativa. La escala es la de `normas/README.md`, y
// confundir los niveles es "el error más caro del dominio", ya cometido dos
// veces en este proyecto: una regla de nivel 1 escrita en absoluto puede tener
// una excepción de nivel 3 que vale dinero (el diésel en efectivo no es
// deducible por LISR 27-III... salvo hasta el 15% por RFA 2026 regla 2.9), y al
// revés, un plazo de nivel 6 —"esta gasolinera factura en 7 días"— NO es una
// obligación fiscal y nunca debe presentarse como tal.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cuánto peso legal tiene, de más a menos. Escala de `normas/README.md`:
 *
 *   1  Ley                                    LISR art. 27 fr. III
 *   2  Reglamento                             RLISR
 *   3  Regla general (RMF) o FACILIDAD (RFA)  RFA 2026 regla 2.9
 *   4  Anexo                                  Anexo 3 de la RMF
 *   5  Criterio NO VINCULATIVO                1/LIF/PI
 *   6  Política de un tercero, cero fuerza legal   plazo del portal de una gasolinera
 */
export type Jerarquia = 1 | 2 | 3 | 4 | 5 | 6;

/** `true` si la norma obliga. De 5 para abajo NO: orienta o informa. */
export function esVinculante(j: Jerarquia): boolean {
  return j <= 4;
}

/**
 * Qué tan verificada está la ficha.
 *  - `verificado_fuente_primaria`: se bajó el texto oficial y se transcribió.
 *  - `evidencia_corroborante`: varias fuentes secundarias coinciden.
 *  - `sin_verificar`: NO se ha comprobado. El producto no debería decidir dinero
 *    sobre una de estas sin marcarlo.
 */
export type EstadoVerificacion = 'verificado_fuente_primaria' | 'evidencia_corroborante' | 'sin_verificar';

export interface Norma {
  id: string;
  instrumento?: string;
  articulo?: string;
  fraccion?: string;
  titulo?: string;
  /** Cómo se escribe en el código y en los mensajes ("LISR 27-III"). */
  citas: string[];
  jerarquia: Jerarquia;
  estado: EstadoVerificacion;
  /**
   * Desde cuándo la norma es EXIGIBLE, si alguna fuente lo respalda. Espejo de
   * `fecha_vigencia_desde` en la ficha (ISO YYYY-MM-DD), y `null` cuando NADIE
   * lo ha confirmado.
   *
   * No es adorno: es el interruptor de los veredictos duros. Una regla
   * redactada en futuro —"el complemento que al efecto publique el SAT en su
   * Portal"— puede estar LATENTE y no vigente, y el motor estaba tirando una
   * deducción de $5,800 más su IVA sobre una fecha que ninguna ficha respalda
   * (la de `config.ts`, fundada en una cita —RMF 2.7.1.8— que no tiene ficha).
   *
   * Con `null` el motor puede AVISAR, nunca declarar no deducible. El día que
   * alguien confirme la fecha en el Portal del SAT, se llena aquí y en la ficha
   * —`normas_sincronizadas.test.ts` obliga a que coincidan— y el veredicto duro
   * se enciende solo.
   */
  exigibleDesde?: string | null;
  /** Ruta de la ficha con el texto vigente y la trazabilidad. */
  ficha: string;
}

export const NORMAS: Record<string, Norma> = {
  'cff-69-B': {
    id: 'cff-69-B',
    instrumento: "Código Fiscal de la Federación",
    articulo: "69-B",
    titulo: "EFOS — comprobantes que amparan operaciones inexistentes",
    citas: ["CFF 69-B"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    ficha: "normas/cff-69-B.yaml",
  },
  'cff-30': {
    id: 'cff-30',
    instrumento: "Código Fiscal de la Federación",
    articulo: "30",
    titulo: "Conservación de la contabilidad y de la documentación — el plazo de cinco años",
    citas: ["CFF 30", "CFF art. 30"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    exigibleDesde: null,
    ficha: "normas/cff-30.yaml",
  },
  'cff-89-90': {
    id: 'cff-89-90',
    instrumento: "Código Fiscal de la Federación",
    articulo: "89 y 90",
    titulo: "Infracciones cuya responsabilidad recae sobre TERCEROS, y su multa — la exposición de Likida",
    citas: ["CFF 89", "CFF 90", "CFF arts. 89 y 90"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    exigibleDesde: null,
    ficha: "normas/cff-89-90.yaml",
  },
  'cff-29-A': {
    id: 'cff-29-A',
    instrumento: "Código Fiscal de la Federación",
    articulo: "29-A",
    titulo: "Requisitos de los comprobantes fiscales digitales",
    citas: ["CFF 29-A", "CFF 29 y 29-A"],
    jerarquia: 1,
    estado: "evidencia_corroborante",
    ficha: "normas/cff-29-A.yaml",
  },
  'criterio-1-CFF-PI': {
    id: 'criterio-1-CFF-PI',
    instrumento: "Anexo 3 de la Resolución Miscelánea Fiscal para 2026 (criterios no vinculativos)",
    articulo: "1/CFF/PI",
    titulo: ">",
    citas: ["1/CFF/PI", "CFF art. 89", "artículo 52 del Código Fiscal"],
    jerarquia: 5,
    estado: "evidencia_corroborante",
    ficha: "normas/criterio-1-CFF-PI.yaml",
  },
  'criterio-1-LIF-PI': {
    id: 'criterio-1-LIF-PI',
    instrumento: "Anexo 3 de la Resolución Miscelánea Fiscal para 2026",
    articulo: "1/LIF/PI",
    titulo: "Estímulo del IEPS de diésel calculado con la cuota disminuida",
    citas: ["1/LIF/PI"],
    jerarquia: 5,
    estado: "evidencia_corroborante",
    ficha: "normas/criterio-1-LIF-PI.yaml",
  },
  'lfpdppp-2025-art-15-16': {
    id: 'lfpdppp-2025-art-15-16',
    instrumento: "Ley Federal de Protección de Datos Personales en Posesión de los Particulares",
    articulo: "15 y 16",
    titulo: "Contenido del aviso de privacidad y cómo ponerlo a disposición",
    citas: ["LFPDPPP 15", "LFPDPPP 16-II"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    exigibleDesde: "2025-03-21",
    ficha: "normas/lfpdppp-15-16.yaml",
  },
  'lfpdppp-2025-art-2-fr-XII-XX': {
    id: 'lfpdppp-2025-art-2-fr-XII-XX',
    instrumento: "Ley Federal de Protección de Datos Personales en Posesión de los Particulares",
    articulo: "2",
    fraccion: "XII y XX",
    titulo: "Persona encargada, y por qué mandarle datos NO es una transferencia",
    citas: ["LFPDPPP 2-XII", "LFPDPPP 2-XX", "LFPDPPP 35"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    exigibleDesde: "2025-03-21",
    ficha: "normas/lfpdppp-2-XII-XX.yaml",
  },
  'lfpdppp-2025-art-26-fr-II': {
    id: 'lfpdppp-2025-art-26-fr-II',
    instrumento: "Ley Federal de Protección de Datos Personales en Posesión de los Particulares",
    articulo: "26",
    fraccion: "II",
    titulo: "Derecho de OPOSICIÓN al tratamiento automatizado sin intervención humana",
    citas: ["LFPDPPP 26-II"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    exigibleDesde: "2025-03-21",
    ficha: "normas/lfpdppp-26-II.yaml",
  },
  'lfpdppp-2025-art-59': {
    id: 'lfpdppp-2025-art-59',
    instrumento: "Ley Federal de Protección de Datos Personales en Posesión de los Particulares",
    articulo: "59",
    titulo: "Sanciones — los rangos reales de multa",
    citas: ["LFPDPPP 59"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    exigibleDesde: "2025-03-21",
    ficha: "normas/lfpdppp-59.yaml",
  },
  'lft-110-111-263': {
    id: 'lft-110-111-263',
    instrumento: "Ley Federal del Trabajo",
    articulo: "110 fr. I, 111 y 263 fr. I",
    titulo: "Qué se le puede descontar a un operador, y qué se le debe pagar aunque no sea deducible",
    citas: ["LFT 110-I", "LFT 111", "LFT 263-I"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    ficha: "normas/lft-110-111-263.yaml",
  },
  'lif-2026-art-20-A': {
    id: 'lif-2026-art-20-A',
    instrumento: "Ley de Ingresos de la Federación para el Ejercicio Fiscal de 2026",
    articulo: "20, apartado A (estímulos fiscales)",
    titulo: "Estímulo de IEPS de diésel para transporte, y estímulo del 50% de peaje",
    citas: ["LIF 2026 Art. 20", "LIF 2026 Art. 20-A", "LIF Art. 20-A fr. IV"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    ficha: "normas/lif-2026-20-A.yaml",
  },
  'lisr-27-fr-III': {
    id: 'lisr-27-fr-III',
    instrumento: "Ley del Impuesto sobre la Renta",
    articulo: "27",
    fraccion: "III",
    titulo: undefined,
    citas: ["LISR 27-III"],
    jerarquia: 1,
    estado: "evidencia_corroborante",
    ficha: "normas/lisr-27-III.yaml",
  },
  'lisr-28-fr-V': {
    id: 'lisr-28-fr-V',
    instrumento: "Ley del Impuesto sobre la Renta",
    articulo: "28",
    fraccion: "V",
    titulo: "Viáticos y gastos de viaje — no deducibles y tope de alimentación",
    citas: ["LISR 28-V"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    ficha: "normas/lisr-28-V.yaml",
  },
  'liva-art-5': {
    id: 'liva-art-5',
    instrumento: "Ley del Impuesto al Valor Agregado",
    articulo: "5",
    titulo: "Requisitos del acreditamiento del IVA",
    citas: ["LIVA art. 5"],
    jerarquia: 1,
    estado: "verificado_fuente_primaria",
    ficha: "normas/liva-5.yaml",
  },
  'politica-portales-plazos-facturacion': {
    id: 'politica-portales-plazos-facturacion',
    instrumento: "Portales de autofacturación de comercios (varios)",
    articulo: undefined,
    titulo: "Ventanas de facturación por cadena",
    citas: ["plazoVerificado"],
    jerarquia: 6,
    estado: "sin_verificar",
    ficha: "normas/politica-portales-plazos.yaml",
  },
  'rfa-2026-2.2': {
    id: 'rfa-2026-2.2',
    instrumento: "Resolución de Facilidades Administrativas para 2026",
    articulo: "2.2",
    titulo: "Facilidades de comprobación (deducción del 8%, 'gasto ciego')",
    citas: ["RFA 2026 regla 2.2"],
    jerarquia: 3,
    estado: "verificado_fuente_primaria",
    exigibleDesde: "2026-02-18",
    ficha: "normas/rfa-2026-2.2.yaml",
  },
  'rfa-2026-2.9': {
    id: 'rfa-2026-2.9',
    instrumento: "Resolución de Facilidades Administrativas para 2026",
    articulo: "2.9",
    titulo: "Adquisición de combustibles",
    citas: ["RFA 2026 regla 2.9"],
    jerarquia: 3,
    estado: "verificado_fuente_primaria",
    exigibleDesde: "2026-02-18",
    ficha: "normas/rfa-2026-2.9.yaml",
  },
  'rlisr-57': {
    id: 'rlisr-57',
    instrumento: "Reglamento de la Ley del Impuesto sobre la Renta",
    articulo: "57",
    titulo: "Establecimiento del contribuyente y viáticos a nombre del trabajador",
    citas: ["RLISR 57"],
    jerarquia: 2,
    estado: "verificado_fuente_primaria",
    ficha: "normas/rlisr-57.yaml",
  },
  'rmf-2026-2.7.1.21': {
    id: 'rmf-2026-2.7.1.21',
    instrumento: "Resolución Miscelánea Fiscal para 2026",
    articulo: "2.7.1.21",
    titulo: "Expedición de comprobantes en operaciones con el público en general (factura global)",
    citas: ["RMF 2.7.1.21"],
    jerarquia: 3,
    estado: "evidencia_corroborante",
    ficha: "normas/rmf-2026-2.7.1.21.yaml",
  },
  'rmf-2026-2.7.1.48': {
    id: 'rmf-2026-2.7.1.48',
    instrumento: "Resolución Miscelánea Fiscal para 2026",
    articulo: "2.7.1.48",
    titulo: "Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos",
    citas: ["2.7.1.48"],
    jerarquia: 3,
    estado: "evidencia_corroborante",
    // NADIE HA CONFIRMADO DESDE CUÁNDO SE EXIGE. La ficha trae
    // `fecha_vigencia_desde: null` y lo dice con todas sus letras: la regla,
    // reformada el 09-jul-2026, sigue redactada en futuro, así que la obligación
    // puede estar latente. Mientras esto sea null, `cuadre/engine.ts` avisa pero
    // NO declara no deducible por falta de complemento.
    exigibleDesde: null,
    ficha: "normas/rmf-2026-2.7.1.48.yaml",
  },
};

/** Todas las normas conocidas. */
export const IDS_NORMA = Object.keys(NORMAS);

/** Devuelve la norma o `undefined`. Nunca inventa una. */
export function norma(id: string): Norma | undefined {
  return NORMAS[id];
}

/**
 * Cómo se escribe una norma para un humano. Sale del índice, nunca del modelo.
 */
export function citaDe(id: string): string | undefined {
  const n = NORMAS[id];
  return n?.citas[0];
}
