// Tipos compartidos entre los lotes del Back-office (firmas fijadas por el plan; cada lote implementa las suyas). Dinero: pesos en
// `numeric(12,2)` en la base; las funciones puras operan en CENTAVOS enteros (sufijo `Cent`). Un valor `null` es «sin dato», jamás 0.
export type { Lectura } from './lectura';

/** Un gasto propio de Likida ya normalizado a MXN (lo implementa `gastos.ts`). */
export interface GastoMes {
  id: string;
  proveedorId: string | null;
  proveedor: string | null;
  fecha: string;
  periodo: string;
  concepto: string | null;
  moneda: 'MXN' | 'USD';
  totalCent: number;
  subtotalCent: number | null;
  ivaAcreditableCent: number | null;
  cfdiUuid: string | null;
  comprobante: 'sin_comprobante' | 'cfdi' | 'invoice_extranjero';
  cuentaContable: string | null;
  conciliado: boolean;
}

/** Resumen de comisiones del mes (lo implementa `comisiones.ts`). */
export interface ComisionMes {
  periodo: string;
  devengadoCent: number;
  clawbackCent: number;
  pagadoCent: number;
}

/** Un movimiento contable ya asentado (lo implementa el libro de `contabilidad.ts`). */
export interface MovimientoContable {
  asientoId: string;
  fecha: string;
  cuenta: string;
  debeCent: number;
  haberCent: number;
  concepto: string | null;
  soporte: 'cfdi' | 'invoice_extranjero' | 'ninguno';
}

export type { ActorAdmin } from '@/lib/admin/acciones_riesgo';
