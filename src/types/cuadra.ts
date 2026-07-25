// ═══════════════════════════════════════════════════════════════════════════
// Tipos del dominio de Cuadra (compartidos por los 3 módulos y el frontend)
// ═══════════════════════════════════════════════════════════════════════════

export type ConceptoGasto = 'diesel' | 'caseta' | 'factura' | 'viaticos' | 'otro';

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
  iepsAcreditable: number; // Σ IEPS de diésel de CFDI deducibles → estímulo vs ISR (LIF 2026 Art. 20)
  ivaAcreditable: number;  // Σ IVA de CFDI deducibles (LIVA art. 5)
  peajeAcreditable: number; // Σ SubTotal de casetas × factor (0.5) → estímulo de peaje (LIF 2026 Art. 20-A)
  creadaEn: string;        // ISO
}

export interface Viaje {
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
