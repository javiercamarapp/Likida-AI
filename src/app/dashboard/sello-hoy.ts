import { fechaCorta, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { selloDe } from '../ui-v2/graficas/cifra';

/** Sello de procedencia de una cifra leída AL ABRIR la pantalla: «<Fuente> · corte 31 oct». La fuente es el registro del que sale
 *  la cifra (nunca un sistema que la pantalla no lee); el corte es el día de la lectura. */
export function selloHoy(fuente: string): string {
  return selloDe(fuente, fechaCorta(hoyMx(new Date(ahoraMs()))));
}
