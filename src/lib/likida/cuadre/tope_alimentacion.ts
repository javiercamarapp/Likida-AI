// ═══════════════════════════════════════════════════════════════════════════
// EL TOPE DIARIO DE ALIMENTACIÓN (LISR 28-V), COMO CRITERIO COMPARTIDO.
//
// AUDITORÍA 4, E4: había DOS motores de IVA acreditable que no coincidían.
// `cuadre/engine.ts` acreditaba en proporción a lo deducible (LIVA 5-I,
// `normas/liva-5.yaml`: "en la proporción en la que dichas erogaciones sean
// deducibles") y `resumirFiscal` en `fiscal.ts` sumaba el IVA COMPLETO del
// mismo comprobante. Sobre un viático de $900 con tope de $750: 83.3% contra
// 100%. Dos números distintos con la misma ley citada al lado es exactamente
// lo que el contralor cruza con una calculadora. El criterio vive AQUÍ, una
// sola vez, y los dos consumidores lo importan: no puede volver a bifurcarse
// sin que se note en el diff.
//
// EL CRITERIO (el del motor, con sus tres decisiones ya pagadas en auditorías):
//
//  1. Solo ALIMENTACIÓN carga el tope. El hospedaje nacional NO lo tiene y el
//     transporte tampoco (`normas/lisr-28-V.yaml`): aplicárselo a "viáticos" en
//     bloque marcaba noches de hotel legítimas. `'viaticos'` a secas entra por
//     compatibilidad: es lo que emitía el OCR viejo y esos gastos ya guardados
//     no se pueden reclasificar solos — criterio conservador, se les sigue
//     aplicando el tope.
//
//  2. Es POR DÍA y por beneficiario, no por comprobante: tres comidas de $400
//     el mismo día no pasan limpias mientras una sola de $800 se marca. Sin
//     fecha no se agrupa: cada comprobante cuenta como su propio día (no se
//     inventa una fecha para poder sumar). El beneficiario es el operador, y
//     por eso ESTO SE LLAMA CON LOS GASTOS DE UN SOLO VIAJE: la liquidación es
//     de un operador, y el panel del contador parte su periodo por viaje antes
//     de llamar. Mezclar viajes de operadores distintos en una llamada
//     compartiría un tope que la ley da por persona.
//
//  3. LA PROPORCIÓN ES DEL DÍA, NO DEL COMPROBANTE QUE CRUZÓ EL TOPE, y se
//     calcula SOLO entre los timbrados: `min(1, tope / totalTimbrado)`.
//     Colgar el exceso del último comprobante acreditaba IVA de más y hacía el
//     resultado depender del ORDEN del arreglo ($92 contra $80 con los mismos
//     hechos — auditoría 3); y dejar que un ticket sin CFDI inflara el
//     denominador le recortaba la deducción a los comprobantes que sí amparan
//     (una comida de $700 con CFDI, bajo el tope, salía "$194.44 deducibles"
//     por un ticket sin timbrar del mismo día — auditoría 8, CRÍTICO). El
//     total del día completo se conserva aparte (`total`) porque la NOTA sí
//     debe avisar del panorama antes de timbrar; lo que se AFIRMA se calcula
//     sobre lo timbrado.
//
// Puro a propósito: sin I/O y sin imports del motor ni del panel, para que
// cualquiera de los dos lo use sin ciclos.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from '@/lib/formato';

/** Lo mínimo que el criterio necesita saber de un comprobante. */
export interface ComprobanteAlimentacion {
  id: string;
  concepto: string;
  monto: number;
  fecha?: string | null;
  cfdiUuid?: string | null;
}

/** ¿El concepto carga el tope? Solo alimentación; `'viaticos'` por compatibilidad (punto 1). */
export function llevaTopeAlimentacion(concepto: string): boolean {
  return concepto === 'alimentacion' || concepto === 'viaticos';
}

export interface DiaSobreTope<G extends ComprobanteAlimentacion> {
  /** `'YYYY-MM-DD'`, o `'sin-fecha:<id>'` cuando el comprobante no trae fecha. */
  dia: string;
  /** Los comprobantes del día, en el orden en que llegaron. */
  delDia: G[];
  /** Todo el día, timbrado o no — el panorama informativo de la nota. */
  total: number;
  /** Solo lo que trae CFDI — la única base sobre la que se afirma. */
  totalTimbrado: number;
  /** `min(1, tope/totalTimbrado)`; `null` si el día no tiene un solo timbrado. */
  proporcionTimbrado: number | null;
  /** El exceso de lo TIMBRADO sobre el tope: lo único que de verdad resta deducción. */
  montoNoDeducible: number;
}

/**
 * Los días cuyo TOTAL (timbrado o no) excede el tope, con su proporción.
 *
 * Se dispara con el día completo a propósito: antes de timbrarse, el contralor
 * quiere saber que ese día tampoco va a deducir entero. Pero la proporción y el
 * no-deducible salen SOLO de lo timbrado (punto 3 del encabezado).
 */
export function diasSobreTope<G extends ComprobanteAlimentacion>(
  gastos: readonly G[],
  tope: number,
): Array<DiaSobreTope<G>> {
  const porDia = new Map<string, G[]>();
  for (const g of gastos) {
    if (!(g.monto > 0) || !llevaTopeAlimentacion(g.concepto)) continue;
    const dia = g.fecha ? g.fecha.slice(0, 10) : `sin-fecha:${g.id}`;
    porDia.set(dia, [...(porDia.get(dia) ?? []), g]);
  }

  const out: Array<DiaSobreTope<G>> = [];
  for (const [dia, delDia] of porDia) {
    const total = delDia.reduce((s, x) => s + x.monto, 0);
    if (total <= tope) continue;
    const totalTimbrado = delDia.filter((x) => x.cfdiUuid).reduce((s, x) => s + x.monto, 0);
    out.push({
      dia,
      delDia,
      total,
      totalTimbrado,
      proporcionTimbrado: totalTimbrado > 0 ? Math.min(1, tope / totalTimbrado) : null,
      montoNoDeducible: totalTimbrado > tope ? round2(totalTimbrado - tope) : 0,
    });
  }
  return out;
}

/**
 * gastoId → fracción deducible, SOLO para los timbrados de días excedidos.
 * Un gasto que no aparezca en el mapa es deducible al 100% — el mismo contrato
 * que `proporcionDeducible` en el motor.
 */
export function proporcionAlimentacionPorGasto<G extends ComprobanteAlimentacion>(
  gastos: readonly G[],
  tope: number | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (tope == null) return out;
  for (const d of diasSobreTope(gastos, tope)) {
    if (d.proporcionTimbrado == null) continue;
    for (const x of d.delDia) if (x.cfdiUuid) out.set(x.id, d.proporcionTimbrado);
  }
  return out;
}
