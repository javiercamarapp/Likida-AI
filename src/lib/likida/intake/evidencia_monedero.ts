// ═══════════════════════════════════════════════════════════════════════════
// FASE 2 — ¿ESTE GASTO ES EVIDENCIA DE UNA CARGA DE MONEDERO?
//
// RMF 2026 regla 3.3.1.7 (normas/rmf-2026-3.3.1.7.yaml): la estación de
// servicio NO debe emitir CFDI al adquirente por operaciones con monedero
// autorizado. El comprobante deducible es el CFDI del emisor + complemento
// ECC. La foto del ticket es control operativo (litros, hora, estación),
// nunca un gasto que "todavía puede facturarse en la gasolinera".
//
// DOS CAMINOS, ninguno adivina:
//
//   A. El RFC del gasto está en la SEMILLA de emisores de monedero
//      (`estaEnPadronMonederos`). Un sí es afirmativo. Un no NO es "no es
//      monedero" — la semilla no es el padrón SAT completo, y los tickets
//      de bomba suelen imprimir el RFC DE LA ESTACIÓN, no el del emisor
//      (PEMEX/ARCO, no Edenred). Ver padron_monederos.ts.
//
//   B. Existe una línea ECC del mismo día, misma estación (RFC) y mismo
//      monto, con las MISMAS tolerancias de consolidado.ts (±$1, ±1 día).
//      Sin RFC de estación no se corre: monto+día solos colisionan con
//      otro diésel del mismo importe.
//
// Puro: no toca la base. `lineasEcc` las inyecta quien llama (desde_db).
// Sin líneas, el camino B no afirma nada.
// ═══════════════════════════════════════════════════════════════════════════

import type { Gasto } from '@/types/likida';
import { estaEnPadronMonederos, emisorMonedero } from './padron_monederos';

/** Tienen que coincidir con `consolidado.ts`. La prueba lo afirma. */
export const TOLERANCIA_ECC_MXN = 1;
export const VENTANA_ECC_DIAS = 1;

export function diasDeDiferenciaEcc(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 86_400_000;
}

function rfcNorm(r: string | undefined | null): string | null {
  if (!r) return null;
  const t = r.trim().toUpperCase();
  return t.length >= 12 ? t : null;
}

export interface LineaEccRef {
  fecha?: string;
  monto: number;
  estacionRfc?: string;
}

export type SenalMonedero =
  | { tipo: 'padron'; rfc: string; emisor: string }
  | { tipo: 'ecc'; estacionRfc: string; monto: number; fecha: string }
  | { tipo: 'ninguna' };

/**
 * ¿Hay evidencia —no una sospecha— de que este gasto es una carga de
 * monedero? `ninguna` significa "no lo sabemos", nunca "no lo es".
 */
export function evidenciaMonedero(
  g: Pick<Gasto, 'rfcEmisor' | 'fecha' | 'monto'>,
  lineasEcc?: readonly LineaEccRef[],
): SenalMonedero {
  const rfc = rfcNorm(g.rfcEmisor);
  if (rfc && estaEnPadronMonederos(rfc)) {
    const emisor = emisorMonedero(rfc);
    return { tipo: 'padron', rfc, emisor: emisor?.emisor ?? rfc };
  }

  const dia = g.fecha?.slice(0, 10);
  const estacion = rfc;
  if (!dia || !estacion || !lineasEcc || !Number.isFinite(g.monto)) return { tipo: 'ninguna' };

  const hit = lineasEcc.find((l) => {
    const est = rfcNorm(l.estacionRfc);
    const fd = l.fecha?.slice(0, 10);
    if (!est || !fd) return false;
    return est === estacion
      && Math.abs(l.monto - g.monto) <= TOLERANCIA_ECC_MXN
      && diasDeDiferenciaEcc(fd, dia) <= VENTANA_ECC_DIAS;
  });
  if (!hit?.fecha) return { tipo: 'ninguna' };
  return {
    tipo: 'ecc',
    estacionRfc: estacion,
    monto: g.monto,
    fecha: hit.fecha.slice(0, 10),
  };
}

export function notaTicketMonedero(senal: Exclude<SenalMonedero, { tipo: 'ninguna' }>): string {
  const cola = 'La gasolinera no puede facturar esta carga (RMF 3.3.1.7): el comprobante deducible es el CFDI del emisor del monedero con el complemento de estado de cuenta, no el ticket de la bomba. Esto es evidencia operativa (litros, hora, estación), no un gasto que espere factura de estación.';
  if (senal.tipo === 'padron') {
    return `Carga con monedero de ${senal.emisor} (RFC ${senal.rfc}). ${cola}`;
  }
  return `Hay una línea del estado de cuenta de combustibles el ${senal.fecha} en la estación ${senal.estacionRfc} por el mismo monto. ${cola}`;
}
