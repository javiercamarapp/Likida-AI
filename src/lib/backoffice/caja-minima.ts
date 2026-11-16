// Candado de caja para abrir un puesto con sueldo fijo (propuesta del agente reclutador, `el-back-office-de-likida.md` §5): no se abre hasta que el
// neto mensual cubra $71,500 MXN/mes Y haya en caja seis meses del costo del puesto. PURO, en pesos enteros del insumo; un insumo null es «No disponible», jamás 0.
export const UMBRAL_NETO_MENSUAL_MXN = 71_500;
export const MESES_CAJA_REQUERIDOS = 6;

export type FaltaCaja = 'neto_mensual' | 'caja' | 'costo_puesto' | 'neto_insuficiente' | 'caja_insuficiente';

export interface EntradaCajaMinima {
  netoMensualMxn: number | null;
  cajaMxn: number | null;
  costoPuestoMxn: number | null;
}

export interface VeredictoCajaMinima {
  permitido: boolean;
  /** Qué impide abrir el puesto. `neto_mensual`, `caja` y `costo_puesto` = ese insumo no está disponible; los `_insuficiente` = hay dato y no alcanza. */
  falta: FaltaCaja[];
  /** Caja que haría falta (6 × costo del puesto); null si no se conoce el costo. */
  cajaRequeridaMxn: number | null;
}

const valido = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function puedeAbrirPuestoFijo(e: EntradaCajaMinima): VeredictoCajaMinima {
  const falta: FaltaCaja[] = [];
  if (!valido(e.netoMensualMxn)) falta.push('neto_mensual');
  else if (e.netoMensualMxn < UMBRAL_NETO_MENSUAL_MXN) falta.push('neto_insuficiente');
  if (!valido(e.costoPuestoMxn)) falta.push('costo_puesto');
  const cajaRequeridaMxn = valido(e.costoPuestoMxn) ? Math.round(e.costoPuestoMxn * MESES_CAJA_REQUERIDOS * 100) / 100 : null;
  if (!valido(e.cajaMxn)) falta.push('caja');
  else if (cajaRequeridaMxn !== null && e.cajaMxn < cajaRequeridaMxn) falta.push('caja_insuficiente');
  return { permitido: falta.length === 0, falta, cajaRequeridaMxn };
}
