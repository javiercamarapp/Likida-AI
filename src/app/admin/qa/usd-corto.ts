import { usd } from '@/lib/formato';

/** Dólares con 2 decimales como Rovaq («US$ 0.11»), sin que una fracción de centavo se lea como «gratis»: de 0 a menos de medio centavo
 *  dice «menos de US$0.01» (no «US$0.00») y un cero exacto es «US$0.00». El formato vive en `lib/formato` (`usd`); aquí solo se decide el piso. */
export function usdCorto(n: number): string {
  if (n === 0) return usd(0);
  if (n > 0 && n < 0.005) return `< ${usd(0.01)}`;
  return usd(n);
}
