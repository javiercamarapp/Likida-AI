'use client';

import { useSyncExternalStore } from 'react';
import type { Idioma } from '@/lib/i18n/idioma';
import { TZ_MX, fechaMx } from '@/lib/formato';
import { LOCALE_INTL } from '@/lib/i18n/idioma';
import { useIdioma } from '@/lib/i18n/proveedor';

/** «31 oct 2026» (es-MX) o «Oct 31, 2026» (en-US), zona de México. Vacío en el servidor: se pinta al hidratar (sin desajuste de hidratación). */
function fechaDeHoy(idioma: Idioma): string {
  if (idioma === 'en') return fechaMx(new Date().toISOString(), 'en');
  const partes = new Intl.DateTimeFormat(LOCALE_INTL[idioma], { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ_MX }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${v('day')} ${v('month').replace('.', '')} ${v('year')}`;
}
const sinSuscripcion = () => () => {};

/** La fecha de hoy: ÚNICA en el shell (topbar de escritorio y cabecera móvil). El chip de fecha de cada página se oculta en v2. */
export default function FechaHoy({ className }: { className: string }) {
  const idioma = useIdioma();
  const fecha = useSyncExternalStore(sinSuscripcion, () => fechaDeHoy(idioma), () => '');
  return <time className={className} suppressHydrationWarning>{fecha}</time>;
}
