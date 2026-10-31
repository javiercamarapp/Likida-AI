import { fechaMx, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';

/** Sello de procedencia de una cifra leída AL ABRIR la pantalla: «<Fuente> · leído 31 oct 2026». Dice lo que es: el día de la LECTURA,
 *  no el corte de la fuente (eso solo se afirma cuando la pantalla conoce la fecha real; ver `selloDe` con su `corte`). La fuente es el
 *  registro del que sale la cifra, nunca un sistema que la pantalla no lee. */
export function selloHoy(fuente: string): string {
  return `${fuente} · leído ${fechaMx(hoyMx(new Date(ahoraMs())))}`;
}
