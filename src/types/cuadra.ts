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
  folio?: string;
  rfcEmisor?: string;
  rfcReceptor?: string;    // debe ser el RFC de la empresa (no el chofer)
  cfdiUuid?: string;
  imagenUrl?: string;
  ocrConfianza?: number;   // 0–1
  cfdiValido?: boolean;
  estadoSat?: EstadoSat;   // resultado de ConsultaCFDIService (o 'pendiente' si SAT no respondió)
  efos?: boolean | null;   // true = emisor en lista negra 69-B (fraude)
  // ── Complemento de hidrocarburos (Bloque 1, NIVEL 2 — solo del XML) ─────────
  claveProdServ?: string;          // c_ClaveProdServ del concepto (del XML)
  claveUnidad?: string;            // c_ClaveUnidad (LTR para combustible)
  tipoComprobante?: string;        // I | E | P | N | T (del XML)
  complementoHidrocarburos?: boolean; // el XML trae el nodo del complemento
  cfdiEsquemaAlterno?: boolean;    // ECC (monedero) o Carta Porte → la regla 2.7.1.48 NO aplica
  xmlVerificado?: boolean;         // true = se recibió y parseó el XML del CFDI
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
  | 'cfdi_no_encontrado'   // el SAT no reconoce el UUID (fabricado/inexistente) → no deducible
  | 'cfdi_pendiente'       // no se pudo validar con el SAT (continuar, revisar después)
  | 'monto_invalido'       // monto ≤ 0 (OCR erróneo / nota de crédito) → revisar a mano
  | 'complemento_hidrocarburos'  // CFDI de combustible SIN el complemento requerido → NO deducible (NIVEL 2, del XML)
  | 'complemento_no_verificable' // factura de combustible sin XML → no se puede verificar el complemento (NIVEL 1, a bandeja)
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
