import { fechaMx, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import type { Idioma } from '@/lib/i18n/idioma';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trDashboardBEs } from '@/lib/i18n/tr_dashboard_b';

/** Sello de procedencia de una cifra leída AL ABRIR la pantalla: «<Fuente> · leído 31 oct 2026». Dice lo que es: el día de la LECTURA,
 *  no el corte de la fuente (eso solo se afirma cuando la pantalla conoce la fecha real; ver `selloDe` con su `corte`). La fuente es el
 *  registro del que sale la cifra, nunca un sistema que la pantalla no lee. Sin `t` ni `idioma` (llamadores viejos, pruebas) habla español. */
export function selloHoy(fuente: string, t: TrDe<'dashboard_b'> = trDashboardBEs, idioma: Idioma = 'es'): string {
  return t('sello.leido', { fuente, fecha: fechaMx(hoyMx(new Date(ahoraMs())), idioma) });
}
