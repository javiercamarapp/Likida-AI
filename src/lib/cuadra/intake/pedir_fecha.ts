// ═══════════════════════════════════════════════════════════════════════════
// «MÁNDAME OTRA FOTO DE ESE TICKET» — y que sepa CUÁL.
//
// El operador acaba de mandar once fotos y guardó el fajo. Decirle "uno de tus
// tickets trae una fecha rara" no es accionable: no sabe cuál es. Por eso el
// mensaje se construye con TODO lo demás que sí se leyó —comercio, total, folio,
// y la fecha tal como venía impresa—, que es lo que le permite encontrar ese
// papel entre los otros diez.
//
// Se le pide en el INTAKE y no al cuadrar, que es la decisión que hace que esto
// sirva: al cuadrar, la liquidación ya se emitió y el trigger de la 0037 impide
// tocar el gasto. Pedírsela entonces sería mandarlo a hacer algo que el sistema
// ya no puede aceptar. Al recibir la foto todavía tiene el ticket en la mano.
//
// LO QUE NO ENTRA EN EL MENSAJE: `producto`. Es el único campo donde un ticket
// revela SALUD —una farmacia imprime el nombre del medicamento— y eso es dato
// sensible del art. 2 fr. VI de la LFPDPPP. Para identificar el papel basta el
// comercio, y el comercio no dice qué se compró.
// ═══════════════════════════════════════════════════════════════════════════

import { mxn, fechaMx } from '@/lib/formato';
import type { MotivoFechaDudosa } from '../cuadre/fecha_dudosa';

export interface TicketPorRefotografiar {
  /** Etiqueta ya resuelta del concepto ("Diésel", "Alimentación"…). */
  etiqueta: string;
  monto: number;
  folio?: string | null;
  /** Razón social leída del ticket. */
  emisor?: string | null;
  /** Nombre o número de estación, cuando lo trae. */
  estacion?: string | null;
  /** La fecha que se interpretó, en ISO. */
  fecha: string;
  /**
   * La fecha TAL COMO venía impresa, sin interpretar.
   *
   * NO es `ocrExtra.fechaRaw`, y esa confusión ya costó una vez: `fechaRaw`
   * guarda lo que el MODELO contestó antes de normalizar, que sale en ISO. Al
   * pintarlo como «venía impresa como "2026-06-01"» junto a «la entendí como 01
   * jun 2026», el renglón repetía la misma fecha dos veces y no delataba nada.
   * Lo útil es lo que el PAPEL dice: `ocrExtra.fechaImpresa`.
   */
  fechaImpresa?: string | null;
  /** Ejercicio corriente, para el texto de `otro_ejercicio`. */
  ejercicioHoy?: number | null;
}

/**
 * El mensaje de WhatsApp. Devuelve texto plano con marcado de WhatsApp (`*`).
 *
 * Cada renglón que se puede llenar se llena: entre más señas, menos tiene que
 * adivinar el operador. Los que no se leyeron se omiten en vez de salir vacíos
 * —un "Folio: —" no ayuda a encontrar nada y hace ver el producto roto.
 */
/** ¿La fecha impresa aporta algo, o repite la que ya se muestra al lado? */
function impresaUtil(t: TicketPorRefotografiar): boolean {
  const i = t.fechaImpresa?.trim();
  if (!i) return false;
  const norm = (s: string) => s.replace(/[^0-9a-záéíóúñ]/gi, '').toLowerCase();
  return norm(i) !== norm(t.fecha) && norm(i) !== norm(fechaMx(t.fecha));
}

export function mensajePideFechaOtraVez(
  t: TicketPorRefotografiar,
  motivo: MotivoFechaDudosa,
): string {
  const señas = [
    `• ${t.etiqueta} por *${mxn(t.monto)}*`,
    t.emisor ? `• Comercio: ${t.emisor}` : null,
    t.estacion ? `• Estación: ${t.estacion}` : null,
    t.folio ? `• Folio: ${t.folio}` : null,
    // La fecha impresa es la seña MÁS útil de todas para encontrar el papel, y
    // además le enseña al operador qué fue lo que se leyó mal: ver
    // «venía impresa como 01/08/26» junto a «la entendí como 8 de enero» hace
    // obvio el error de día/mes sin tener que explicárselo.
    //
    // Solo si DIFIERE de lo interpretado. Si el modelo devolvió la misma cadena
    // —porque no alcanzó a copiarla literal—, el paréntesis repetiría la fecha
    // que va a su izquierda y el renglón dejaría de decir nada.
    `• Fecha que entendí: ${fechaMx(t.fecha)}${impresaUtil(t) ? ` (venía impresa como "${t.fechaImpresa}")` : ''}`,
  ].filter(Boolean).join('\n');

  const porQue = motivo === 'otro_ejercicio'
    ? `Esa fecha es de ${Number(t.fecha.slice(0, 4))}${t.ejercicioHoy ? ` y estamos en ${t.ejercicioHoy}` : ''}, así que algo se leyó mal.`
    : 'Esa fecha queda fuera de las fechas de tu viaje, así que algo se leyó mal.';

  return `📅 Ojo con uno de tus tickets:\n\n${señas}\n\n${porQue} Sin la fecha buena no puedo calcular hasta cuándo se puede facturar, que es donde se pierde el dinero.\n\n¿Me mandas otra foto de *ese mismo ticket*, enfocando la parte donde viene la fecha? 📸 Ya lo registré, así que no se te va a duplicar.`;
}
