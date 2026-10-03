// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — cómo se DICE una cifra que no es nuestra.
//
// El formato de cifras vive solo en `lib/formato.ts` (hay una prueba que lo
// exige). Aquí solo se compone: moneda explícita siempre, porque a diferencia
// del cuadre —que es todo en pesos— una liquidación externa puede venir en
// dólares, y «$1,200.00» sin moneda en un documento de pago es ambiguo.
// ═══════════════════════════════════════════════════════════════════════════

import { mxn, usd, fechaMx } from '@/lib/formato';
import type { MonedaExterna } from './esquema';

export function dinero(n: number, moneda: MonedaExterna): string {
  return moneda === 'USD' ? `${usd(n)} USD` : `${mxn(n)} MXN`;
}

export function periodoTexto(desde: string, hasta: string): string {
  return desde === hasta ? fechaMx(desde) : `${fechaMx(desde)} al ${fechaMx(hasta)}`;
}

export const TITULO_BOTON_RECIBIDA = 'Recibida';
export const TITULO_BOTON_NO_COINCIDE = 'No coincide';

/** El prefijo de los ids de botón. El resto es el uuid de la liquidación. */
export const PREFIJO_BOTON_RECIBIDA = 'liqext_ok:';
export const PREFIJO_BOTON_NO_COINCIDE = 'liqext_no:';

/** El saludo usa el primer nombre, acotado: `operador.nombre` no tiene tope en
 *  la base y Meta rechaza el mensaje ENTERO si el cuerpo pasa de 1,024. Recortar
 *  un saludo es inocuo; recortar una cifra no lo es (por eso las cifras nunca se
 *  recortan y el resto del cuerpo tiene largo acotado). */
export function primerNombre(nombre: string): string {
  const p = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return p.slice(0, 40) || 'Hola';
}

/**
 * El cuerpo del mensaje al chofer. Lleva las cifras que el chofer necesita
 * para decidir si le cuadra SIN abrir el PDF: periodo y total. El desglose
 * vive en el PDF; en el cuerpo no se repiten renglones (Meta corta a 1,024
 * caracteres y un renglón recortado partiría una cifra).
 */
export function cuerpoMensaje(d: {
  nombre: string; desde: string; hasta: string; total: number; moneda: MonedaExterna; sistemaOrigen: string | null;
}): string {
  const primer = primerNombre(d.nombre);
  const origen = d.sistemaOrigen ? ` (${d.sistemaOrigen})` : '';
  return [
    `Hola ${primer}, esta es tu liquidación${origen}.`,
    `Periodo: ${periodoTexto(d.desde, d.hasta)}`,
    `Total: ${dinero(d.total, d.moneda)}`,
    'El detalle va en el PDF. ¿Te cuadra? Respóndeme con un botón.',
  ].join('\n');
}
