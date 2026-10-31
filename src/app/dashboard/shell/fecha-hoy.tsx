'use client';

import { useSyncExternalStore } from 'react';
import { TZ_MX } from '@/lib/formato';

/** «31 oct 2026», es-MX, zona de México. Vacío en el servidor: se pinta al hidratar (sin desajuste de hidratación). */
function fechaDeHoy(): string {
  const partes = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ_MX }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${v('day')} ${v('month').replace('.', '')} ${v('year')}`;
}
const sinSuscripcion = () => () => {};

/** La fecha de hoy: ÚNICA en el shell (topbar de escritorio y cabecera móvil). El chip de fecha de cada página se oculta en v2. */
export default function FechaHoy({ className }: { className: string }) {
  const fecha = useSyncExternalStore(sinSuscripcion, fechaDeHoy, () => '');
  return <time className={className} suppressHydrationWarning>{fecha}</time>;
}
