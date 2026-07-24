// ═══════════════════════════════════════════════════════════════════════════
// Tipos del dominio de Cuadra (compartidos por los 3 módulos y el frontend)
// ═══════════════════════════════════════════════════════════════════════════

export type ConceptoGasto = 'diesel' | 'caseta' | 'factura' | 'viaticos' | 'otro';

/** Un comprobante extraído por OCR del Módulo 1 (Intake). */
export interface Gasto {
  id: string;
  concepto: ConceptoGasto;
  monto: number;
  fecha?: string;          // ISO
  folio?: string;
  rfcEmisor?: string;
  cfdiUuid?: string;
  imagenUrl?: string;
  ocrConfianza?: number;   // 0–1
  cfdiValido?: boolean;
}

export type TipoDiferencia =
  | 'sobre_politica'       // monto excede el tope de la política
  | 'sin_comprobante'      // gasto esperado del trayecto sin comprobante
  | 'duplicado'            // mismo folio/monto repetido
  | 'sin_cfdi'             // requiere CFDI y no lo trae
  | 'anticipo'             // diferencia contra el anticipo entregado
  | 'ocr_baja_confianza';  // extracción dudosa, revisar a mano

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
