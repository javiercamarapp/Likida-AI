// ═══════════════════════════════════════════════════════════════════════════
// EL CRUCE — donde la descarga masiva se convierte en valor (0231).
//
// Bajar CFDI no sirve de nada por sí solo. Lo que le cambia el día al contralor
// es que el comprobante que el comercio ya timbró se PEGUE al ticket que el
// chofer fotografió, sin que nadie entre a un portal. Este archivo decide ese
// pegado, y es puro a propósito: la decisión que mueve dinero se prueba sin
// base de datos.
//
// ─────────────────────────────────────────────────────────────────────────
// LAS TRES REGLAS, EN ORDEN, Y POR QUÉ CADA UNA
//
// 1. UN CFDI DE EMISOR DE MONEDERO NO SE CRUZA 1:1 — NUNCA.
//    Regla 3.3.1.7 de la RMF: cuando se paga con monedero autorizado, la
//    GASOLINERA NO LE FACTURA AL CLIENTE. Le factura al emisor del monedero, y
//    el comprobante deducible de la flota es el CFDI MENSUAL del emisor con su
//    complemento ECC — un solo folio con cientos de cargas adentro. Cruzarlo
//    por total contra un gasto sería catastrófico: pegaría un CFDI de cientos
//    de miles de pesos a una carga de $600, dejaría el resto sin comprobante y
//    afirmaría un IVA acreditable que no corresponde. Estos CFDI se van por el
//    camino que YA existe para ellos (`guardarYConciliarConsolidado`, 0076),
//    que concilia LÍNEA POR LÍNEA. Aquí solo se detectan y se apartan.
//
// 2. UN GASTO QUE SE PAGÓ CON MONEDERO NO ACEPTA CFDI DE ESTACIÓN.
//    La otra mitad de la misma regla. Un ticket de bomba con señal de monedero
//    (`evidenciaMonedero`) tiene su comprobante en la línea ECC del emisor, no
//    en un CFDI de la estación — que por ley no existe. Si apareciera uno con
//    ese total, pegarlo contaría el mismo litro dos veces. Sale del fondo de
//    candidatos y se dice por qué.
//
// 3. EL RFC MANDA CUANDO SE CONOCE.
//    Si el ticket trajo RFC del emisor (el OCR lo leyó, o el código de barras),
//    tiene que ser el MISMO del CFDI. Dos gastos de $1,160 el mismo día en
//    proveedores distintos es corriente; sin esta condición el cruce sería una
//    moneda al aire. Cuando el ticket NO trae RFC no se inventa: se cruza por
//    monto y fecha, que es exactamente lo que `emparejarXmlConTicket` ya sabe
//    hacer, y esa decisión NO se reescribe aquí.
//
// Y la regla que las envuelve: ANTE LA DUDA NO SE ADIVINA. Dos candidatos que
// empatan son un caso del contralor, no una moneda al aire — se devuelven con
// nombre y apellido para que los resuelva una persona.
// ═══════════════════════════════════════════════════════════════════════════

import type { Gasto } from '@/types/likida';
import type { CfdiXmlData } from '../intake/cfdi_xml';
import { emparejarXmlConTicket } from '../intake/emparejar';
import { estaEnPadronMonederos, emisorMonedero } from '../intake/padron_monederos';
import { evidenciaMonedero } from '../intake/evidencia_monedero';

/** Qué se decidió hacer con un CFDI bajado del buzón. */
export type DestinoCfdi =
  /** Casó con un gasto ya registrado: queda facturado sin pisar un portal. */
  | { destino: 'casado'; gastoId: string }
  /** Varios gastos empatan. NO se liga nada; lo resuelve el contralor. */
  | { destino: 'ambiguo'; candidatos: CandidatoCruce[] }
  /** CFDI mensual de emisor de monedero: se concilia línea por línea por el
   *  camino de consolidados, jamás 1:1. */
  | { destino: 'consolidado'; emisor: string }
  /** Ningún gasto le corresponde. NO es un error: puede ser un gasto que
   *  nadie reportó, y eso también es un hallazgo. */
  | { destino: 'disponible'; motivo: string };

export interface CandidatoCruce {
  gastoId: string;
  monto: number;
  fecha: string | null;
  concepto: string;
}

/** Lo que el cruce necesita saber de las líneas ECC ya conocidas de la flota,
 *  para reconocer un ticket pagado con monedero. Es el mismo tipo que consume
 *  `evidenciaMonedero`; se re-declara estructural para no acoplar módulos. */
export interface LineaEccRef {
  estacionRfc?: string;
  monto: number;
  fecha?: string;
}

function candidatoDe(g: Gasto): CandidatoCruce {
  return { gastoId: g.id, monto: g.monto, fecha: g.fecha ?? null, concepto: g.concepto };
}

/**
 * Decide qué hacer con UN CFDI recién bajado, contra los gastos de la flota.
 *
 * `gastos` debe traer solo gastos SIN CFDI todavía: los que ya tienen folio no
 * son candidatos y filtrarlos aquí evitaría que el llamador se acuerde. Aun
 * así `emparejarXmlConTicket` lo re-verifica — dos redes sobre el mismo dinero.
 */
export function decidirCruce(
  cfdi: Pick<CfdiXmlData, 'total' | 'fecha' | 'rfcEmisor' | 'uuid' | 'lineas'>,
  gastos: readonly Gasto[],
  lineasEcc: readonly LineaEccRef[] = [],
): DestinoCfdi {
  // ── Regla 1: el CFDI del emisor de monedero no se cruza 1:1 ──────────────
  // Se pregunta ANTES que nada: da igual cuántos gastos empaten por total, un
  // consolidado no le pertenece a ninguno solo.
  if (estaEnPadronMonederos(cfdi.rfcEmisor)) {
    const e = emisorMonedero(cfdi.rfcEmisor ?? '');
    return {
      destino: 'consolidado',
      emisor: e ? `${e.emisor} (${e.producto})` : (cfdi.rfcEmisor ?? 'emisor de monedero'),
    };
  }
  // Un CFDI con varias líneas ECC es un consolidado aunque su emisor no esté en
  // la semilla del padrón — que NO es autoritativa (`estaEnPadronMonederos`
  // devuelve un sí afirmativo, nunca un no autoritativo). La forma del
  // comprobante manda sobre la lista.
  if (cfdi.lineas.filter((l) => l.fuente === 'ecc12').length > 1) {
    return { destino: 'consolidado', emisor: cfdi.rfcEmisor ?? 'emisor con complemento ECC' };
  }

  if (cfdi.total == null || !(cfdi.total > 0)) {
    return { destino: 'disponible', motivo: 'El CFDI no trae total legible: sin monto no se cruza nada.' };
  }

  // ── Regla 2: fuera los gastos que se pagaron con monedero ────────────────
  const sinMonedero = gastos.filter((g) =>
    evidenciaMonedero(g, lineasEcc).tipo === 'ninguna');
  const apartadosPorMonedero = gastos.length - sinMonedero.length;

  // ── Regla 3: el RFC manda cuando el ticket lo trae ───────────────────────
  const rfcCfdi = cfdi.rfcEmisor?.trim().toUpperCase() ?? '';
  const fondo = rfcCfdi === '' ? sinMonedero : sinMonedero.filter((g) => {
    const rfcGasto = g.rfcEmisor?.trim().toUpperCase() ?? '';
    // Ticket sin RFC leído: sigue siendo candidato (el OCR no siempre lo saca).
    // Ticket CON RFC distinto: no es éste, y no se adivina lo contrario.
    return rfcGasto === '' || rfcGasto === rfcCfdi;
  });

  // La DECISIÓN no se reescribe: la toma `emparejarXmlConTicket`, que ya sabe
  // exigir candidato único y desempatar por día. Aquí solo se le entrega el
  // fondo correcto.
  const elegido = emparejarXmlConTicket({ total: cfdi.total, fecha: cfdi.fecha }, [...fondo]);
  if (elegido !== null) return { destino: 'casado', gastoId: elegido.id };

  // No hubo único. Distinguir "ninguno" de "varios" es la diferencia entre un
  // hallazgo y una tarea: se recalcula el empate SOLO para reportarlo.
  const empatan = fondo.filter((g) => !g.cfdiUuid && Math.abs(g.monto - cfdi.total!) <= 0.01);
  if (empatan.length > 1) {
    return { destino: 'ambiguo', candidatos: empatan.map(candidatoDe) };
  }
  if (apartadosPorMonedero > 0 && empatan.length === 0) {
    return {
      destino: 'disponible',
      motivo: `Ningún gasto sin factura corresponde a este importe. ${apartadosPorMonedero} gasto${apartadosPorMonedero === 1 ? '' : 's'} con ese monto se apartó por estar pagado con monedero: su comprobante es el CFDI mensual del emisor con complemento ECC, no uno de la estación (RMF 3.3.1.7).`,
    };
  }
  return {
    destino: 'disponible',
    motivo: 'Ningún gasto registrado corresponde a este comprobante. Puede ser un gasto que nadie reportó — revísalo.',
  };
}
