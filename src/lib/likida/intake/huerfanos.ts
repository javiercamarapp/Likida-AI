// ═══════════════════════════════════════════════════════════════════════════
// QUÉ SE LE DICE AL OPERADOR SOBRE LOS COMPROBANTES QUE QUEDARON SIN VIAJE.
//
// El principio de todo esto, y no admite excepción: UNA FOTO NUNCA SE RECHAZA.
//
// No todos los choferes escriben «hola» ni esperan a que la oficina les abra el
// viaje. Terminan la ruta, sacan el fajo y mandan once fotos de golpe. Hasta el
// 1-ago-2026 ese operador perdía once comprobantes y no se enteraba: se le
// contestaba «No tienes un viaje abierto», que es cierto y no es lo que pasó.
// Lo que pasó es que se tiraron sus tickets.
//
// Y NO SE ADJUNTAN SOLOS. Un ticket del viaje anterior metido en el de hoy es
// dinero en la liquidación equivocada, y nadie lo nota hasta que el contralor
// paga. Se le enseña qué hay y se le pregunta; cuesta un mensaje.
// ═══════════════════════════════════════════════════════════════════════════

import { mxn } from '@/lib/formato';
import { strip_accents } from '../cuadre/util';

export interface Esperando {
  monto: number;
  etiqueta: string;
}

/** Acuse de la foto que llegó sin viaje al cual ponerla. */
export function mensajeGuardadoSinViaje(cuantos: number): string {
  const n = cuantos === 1 ? 'ese comprobante' : `esos ${cuantos} comprobantes`;
  return `📸 Recibí ${n} y ya ${cuantos === 1 ? 'quedó guardado' : 'quedaron guardados'}. ` +
    `Todavía no tienes un viaje abierto, así que no los puedo cuadrar aún — pero *no se pierden*: ` +
    `en cuanto tu flota te asigne uno te pregunto si van ahí. 👍`;
}

/**
 * La foto que llegó después de emitida la liquidación.
 *
 * Antes decía «NO entró. Guárdalo: mándalo en tu siguiente viaje o pídele a la
 * oficina que lo agregue» — y eso mandaba al operador a un trámite que no
 * existe, con un papel que nadie iba a capturar. El comprobante se perdía de
 * verdad; solo que despacio.
 */
export function mensajeGuardadoTrasLiquidar(monto: number): string {
  return `Ya cerré esta liquidación, así que ese comprobante de *${mxn(monto)}* no entró en ella.\n\n` +
    `Pero *no se perdió*: lo guardé y te lo agrego en cuanto abras tu siguiente viaje. 📸`;
}

/**
 * El ofrecimiento, con lo que trae cada uno para que el operador pueda decir que no.
 *
 * PEDÍA «contesta *sí* o dime cuáles no van», y eso no existe: `esAfirmacion` y
 * `esNegacion` son todo o nada A PROPÓSITO —una respuesta parcial («no, el de
 * diésel no») no se sabe resolver, y tratarla como un no rotundo descartaría los
 * demás sin que él lo pidiera—. Quien contestaba lo que se le pedía caía en el
 * hueco: ni sí ni no, así que el mensaje se iba al agente y el ofrecimiento se
 * quedaba en pie. Se ofrece lo que el código sí sabe hacer.
 */
export function mensajeOfrecer(pendientes: Esperando[], ruta?: string): string {
  const total = pendientes.reduce((s, p) => s + p.monto, 0);
  const lista = pendientes.slice(0, 12).map((p) => `• ${p.etiqueta} · *${mxn(p.monto)}*`).join('\n');
  const demas = pendientes.length > 12 ? `\n• …y ${pendientes.length - 12} más` : '';
  const cuantos = pendientes.length === 1
    ? 'Tengo 1 comprobante tuyo'
    : `Tengo ${pendientes.length} comprobantes tuyos`;
  return `Ya tienes viaje abierto${ruta ? ` (${ruta})` : ''} ✅\n\n` +
    `${cuantos} que quedaron sin viaje, ${mxn(total)} en total:\n\n${lista}${demas}\n\n` +
    `¿${pendientes.length === 1 ? 'Lo agrego' : 'Los agrego'} a este viaje? Contéstame *sí* o *no* — es para todos, todavía no sé separarlos de uno en uno. 👍`;
}

/**
 * Lo que se contesta cuando dijo que sí.
 *
 * DICE EL NETO, NO SOLO LA SUMA DEL PAPEL. Medido el 1-ago: se adjuntaron 17
 * comprobantes y el acuse dijo «$28,041.15»; tres mensajes después la
 * liquidación decía «$12,388.05 comprobado», porque seis venían repetidos. El
 * acuse era exacto —eso fue lo que se agregó— y aun así ponía en la cabeza del
 * operador un número que se caía a la mitad. Un chofer lee $28 mil y luego $12
 * mil y entiende que le recortaron.
 *
 * El dedup ya se puede calcular en ese momento, así que se calcula y se dice.
 * Cuando no se puede (`neto` ausente), el mensaje NO promete un total del viaje:
 * callar es mejor que arriesgar la cifra que después contradice el PDF.
 *
 * Y no dice «cuando termines de mandar los demás»: no faltaba ninguno, y eso
 * sonaba a que algo quedó pendiente justo después de vaciar la sala de espera.
 */
export function mensajeAdjuntados(
  pendientes: Esperando[],
  neto?: { copias: number; comprobado: number },
): string {
  const total = pendientes.reduce((s, p) => s + p.monto, 0);
  const cabeza = pendientes.length === 1
    ? `Listo, agregué ese comprobante de *${mxn(total)}* a tu viaje ✅.`
    : `Listo, agregué los ${pendientes.length} comprobantes a tu viaje ✅ — ${mxn(total)} en papel.`;
  const cuerpo = !neto ? ''
    : neto.copias > 0
      ? `\n\nEncontré *${neto.copias} ${neto.copias === 1 ? 'repetido' : 'repetidos'}*, que cuento una sola vez. En este viaje llevas *${mxn(neto.comprobado)}* comprobado.`
      : `\n\nEn este viaje llevas *${mxn(neto.comprobado)}* comprobado.`;
  return `${cabeza}${cuerpo}\n\nSi te falta alguno, mándalo. Cuando ya no tengas más, escribe *listo*. 👍`;
}

const norm = (t: string) => strip_accents(t.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ').trim();

/**
 * ¿Dijo que sí?
 *
 * Deliberadamente ESTRECHO. Ante la duda no se adjunta: un falso positivo mete
 * el ticket de otro viaje en éste —dinero en la liquidación equivocada—
 * mientras que un falso negativo solo deja el ofrecimiento en pie, y se le
 * vuelve a preguntar. Los dos errores no cuestan lo mismo.
 *
 * Por eso `listo` NO cuenta como sí, aunque llegue justo después de la
 * pregunta: quiere decir «cierra mi viaje», y confundirlos cerraría con
 * comprobantes que el operador nunca aceptó.
 */
export function esAfirmacion(texto: string): boolean {
  const t = norm(texto);
  if (!t || t.split(/\s+/).length > 4) return false;
  if (/\bno\b/.test(t)) return false;
  return /^(si|sip|simon|claro|correcto|exacto|va|vale|sale|dale|ok|okey|okay|adelante|agregalos|agregalo|ponlos|ponlo|todos|si van|si porfa|si por favor)\b/.test(t);
}

/**
 * ¿Dijo que no?
 *
 * Solo un NO limpio. «no, el de diesel no» es una respuesta parcial que este
 * flujo no sabe resolver, y tratarla como un no rotundo descartaría los otros
 * comprobantes sin que el operador lo pidiera. Cuando no se entiende, se deja
 * todo pendiente y decide una persona.
 */
export function esNegacion(texto: string): boolean {
  const t = norm(texto);
  if (!t || t.split(/\s+/).length > 4) return false;
  return /^(no|nel|nop|ninguno|ninguna|no van|no son|todavia no|aun no)\b/.test(t);
}
