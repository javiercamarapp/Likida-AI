// Constantes PURAS del LOTE C que también necesitan los formularios de cliente (nada de base ni de servidor aquí).
export const CADENCIAS_PROVEEDOR = ['mensual', 'anual', 'por_uso'] as const;
export type CadenciaProveedor = (typeof CADENCIAS_PROVEEDOR)[number];

export const TIPOS_CUENTA = ['banco', 'stripe', 'caja'] as const;
export type TipoCuenta = (typeof TIPOS_CUENTA)[number];

/** Conceptos que una persona puede capturar. `traspaso` existe en la base pero necesita dos patas: no se ofrece. `reversa` solo nace de reversar. */
export const CONCEPTOS_MANUALES = ['saldo_inicial', 'ingreso', 'egreso', 'ajuste'] as const;
export type ConceptoManual = (typeof CONCEPTOS_MANUALES)[number];
