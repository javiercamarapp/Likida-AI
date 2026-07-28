// ═══════════════════════════════════════════════════════════════════════════
// Tipos del dominio de Cuadra (compartidos por los 3 módulos y el frontend)
// ═══════════════════════════════════════════════════════════════════════════

// El viático se parte en tres porque el TOPE FISCAL de $750/día (LISR 28-V) es
// SOLO de alimentación: el hospedaje nacional no tiene tope y el transporte del
// operador tampoco. 'viaticos' se conserva como genérico HEREDADO —es lo que
// emitía el OCR viejo y esos gastos ya guardados no se reclasifican solos—;
// para gastos nuevos hay que usar el concepto específico.
// `flete` existe separado de `transporte` por una razón fiscal, no de orden.
// LISR 28-V condiciona la deducción del viático de alimentos a que un
// comprobante de hospedaje o de transporte lo ampare, y ahí "transporte" es el
// traslado DE LA PERSONA. Una guía de paquetería es el traslado de una caja.
//
// Con los dos en el mismo concepto, tres guías de Paquetexpress silenciaban la
// advertencia sobre una comida de $1,050 —medido el 28-jul-2026 sobre tickets
// reales—: el motor daba por amparado un viático que la ley no ampara, y lo
// hacía callando. Encima trataba un flete de $1,370 como viático, sujeto a
// reglas (RLISR 57, nombre en el comprobante) que no le tocan.
export type ConceptoGasto =
  | 'diesel' | 'caseta' | 'factura'
  | 'alimentacion' | 'hospedaje' | 'transporte'
  | 'flete'     // paquetería y carga: NO es viático, no ampara alimentos
  | 'viaticos'  // heredado: genérico, se le aplica el tope por precaución
  | 'otro';

export type EstadoSat = 'vigente' | 'cancelado' | 'no_encontrado' | 'pendiente';

/** Un comprobante extraído por OCR del Módulo 1 (Intake). */
export interface Gasto {
  id: string;
  concepto: ConceptoGasto;
  monto: number;
  fecha?: string;          // ISO
  folio?: string;          // crudo, tal cual del ticket (con ceros a la izquierda)
  folioNorm?: string;      // normalizado sin padding (lo que piden los portales)
  ocrExtra?: Record<string, unknown>; // datos ricos del ticket (litros, webId, estación, iva leído…)
  rfcEmisor?: string;
  rfcReceptor?: string;    // debe ser el RFC de la empresa (no el chofer)
  cfdiUuid?: string;
  imagenUrl?: string;
  imgHash?: string;        // SHA-256 del contenido de la foto (dedup de reenvíos)
  ocrConfianza?: number;   // 0–1
  cfdiValido?: boolean;
  estadoSat?: EstadoSat;   // resultado de ConsultaCFDIService (o 'pendiente' si SAT no respondió)
  efos?: boolean | null;   // true = emisor en lista negra 69-B (fraude)
  efosRevisar?: boolean;   // SAT devolvió un código EFOS no concluyente → a bandeja (1.9)
  // ── Complemento de hidrocarburos (Bloque 1, NIVEL 2 — solo del XML) ─────────
  claveProdServ?: string;          // c_ClaveProdServ del concepto (del XML)
  claveUnidad?: string;            // c_ClaveUnidad (LTR para combustible)
  tipoComprobante?: string;        // I | E | P | N | T (del XML)
  complementoHidrocarburos?: boolean; // el XML trae el nodo del complemento
  cfdiEsquemaAlterno?: boolean;    // ECC (monedero) o Carta Porte → la regla 2.7.1.48 NO aplica
  xmlVerificado?: boolean;         // true = se recibió y parseó el XML del CFDI
  // ── Acreditamiento (del XML) ────────────────────────────────────────────────
  formaPago?: string;              // c_FormaPago (01=efectivo…) — deducibilidad por medio de pago
  subTotal?: number;               // @SubTotal (base del estímulo de peaje 50%)
  iepsTraslado?: number;           // IEPS desglosado (Traslado 003) → acreditable vs ISR
  ivaTraslado?: number;            // IVA desglosado (Traslado 002) → acreditable
}

export type TipoDiferencia =
  | 'sobre_politica'       // monto excede el tope de la política
  | 'sin_comprobante'      // gasto esperado del trayecto sin comprobante
  | 'duplicado'            // mismo UUID/folio/monto repetido
  | 'sin_cfdi'             // requiere CFDI y no lo trae
  | 'anticipo'             // diferencia contra el anticipo entregado
  | 'ocr_baja_confianza'   // extracción dudosa, revisar a mano
  | 'rfc_receptor'         // CFDI timbrado a un RFC distinto al de la empresa
  | 'rfc_receptor_no_verificable' // el RFC de la flota no sirve: no se puede confirmar NI descartar
  | 'cfdi_cancelado'       // CFDI cancelado ante el SAT → no deducible
  | 'cfdi_efos'            // emisor en lista negra 69-B → no deducible
  | 'cfdi_efos_indeterminado' // SAT devolvió código EFOS no concluyente → a bandeja (no fraude)
  | 'cfdi_no_encontrado'   // el SAT no reconoce el UUID (fabricado/inexistente) → no deducible
  | 'cfdi_pendiente'       // no se pudo validar con el SAT (continuar, revisar después)
  | 'monto_invalido'       // monto ≤ 0 (OCR erróneo / nota de crédito) → revisar a mano
  | 'complemento_hidrocarburos'  // CFDI de combustible SIN el complemento requerido → NO deducible (NIVEL 2, del XML)
  | 'complemento_no_verificable' // factura de combustible sin XML → no se puede verificar el complemento (NIVEL 1, a bandeja)
  | 'combustible_efectivo' // combustible pagado en efectivo → NO deducible (LISR 27-III, sin importar monto)
  | 'efectivo_sobre_tope'  // gasto no-combustible en efectivo > $2,000 → NO deducible (LISR 27-III)
  | 'ieps_no_desglosado'   // CFDI de diésel sin IEPS desglosado → no acreditable (se pierde el estímulo)
  | 'viatico_excede_fiscal' // viático de alimentación > tope fiscal $750/día (LISR 28-V) → porción no deducible
  | 'fecha_sospechosa'     // fecha futura o muy anterior al viaje → periodo/plazo/complemento en riesgo
  | 'folio_verificar'      // folio leído con baja confianza en ticket con portal → verificar antes de facturar
  | 'monto_discrepante'    // el total del código y el del OCR no coinciden
  | 'texto_sospechoso'     // el papel traía texto dirigido al extractor
  | 'alimentacion_sin_soporte' // comida sin hospedaje ni transporte que la ampare (LISR 28-V)
  | 'viatico_rfc_operador'  // viático a nombre de una persona: válido si es el operador (RLISR 57)
  | 'factura_por_vencer'   // ticket de portal sin timbrar y con la ventana cerrándose
  | 'diesel_desviacion';   // consumo de diésel fuera del rango esperado

/** Una diferencia detectada por el Módulo 2 (Cuadre). */
export interface Diferencia {
  tipo: TipoDiferencia;
  concepto?: ConceptoGasto;
  esperado?: number;
  real?: number;
  monto: number;           // impacto en pesos (+ a favor empresa)
  nota: string;            // explicación legible para el operador/gerente
  gastoId?: string;
}

export type EstatusLiquidacion = 'cuadrada' | 'con_diferencias' | 'revisar';

/** Resultado del cuadre — lo que consume el PDF y el export a ERP. */
export interface Liquidacion {
  id: string;
  viajeId: string;
  totalComprobado: number;
  totalAnticipo: number;
  diferencia: number;      // + a favor empresa, - a favor operador
  estatus: EstatusLiquidacion;
  diferencias: Diferencia[];
  gastos: Gasto[];
  // ── Deducibilidad: las tres cubetas SIEMPRE suman totalComprobado ───────────
  totalDeducible: number;    // lo que sí se puede deducir para ISR
  totalNoDeducible: number;  // lo que se perdió (incluye solo el EXCEDENTE del viático)
  /** Combustible en efectivo: deducible hasta el 15% del ejercicio (RFA 2026
   *  regla 2.9). No es deducible ni perdido hasta que el contador del 15% exista. */
  totalPorConfirmar: number;
  /**
   * DEPRECADO como cifra de venta: se deja en 0. El estímulo del LIF 2026 art.
   * 20-A es cuota semanal disminuida × litros, y sin el acuerdo del DOF no se
   * puede calcular. Ver `litrosDieselAcreditables`.
   */
  iepsAcreditable: number;
  /** Litros de diésel que cumplen clave de producto Y medio de pago (LIF 20-A-IV). */
  litrosDieselAcreditables: number; // Σ IEPS de diésel de CFDI deducibles → estímulo vs ISR (LIF 2026 Art. 20)
  ivaAcreditable: number;  // Σ IVA de CFDI deducibles (LIVA art. 5)
  peajeAcreditable: number; // Σ SubTotal de casetas × factor (0.5) → estímulo de peaje (LIF 2026 Art. 20-A)
  creadaEn: string;        // ISO
}

export interface Viaje {
  /**
   * LFT 263 fr. I: el viaje se prolongó por causa NO imputable al operador.
   * `undefined` = sin determinar, que NO es lo mismo que `false`.
   */
  demoraNoImputable?: boolean;
  id: string;
  folio?: string;
  origen?: string;
  destino?: string;
  anticipo: number;
  fechaInicio?: string;
  fechaFin?: string;
}

export interface Operador {
  id: string;
  nombre: string;
  telefono: string;
  terminal?: string;
}
