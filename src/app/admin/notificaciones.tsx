'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { Alerta } from './calcular-alertas';
import { leerLeidas, claveAlerta, suscribirCambiosLeidas, SIN_LEIDAS } from './notificaciones-leidas';

/**
 * La campana ya NO abre un dropdown — lleva a /admin/notificaciones, una
 * página real. Sigue siendo solo un punto rojo, NUNCA un número dentro de
 * un círculo — pedido explícito del usuario, no un contador de badge tipo
 * app store. El punto ahora respeta "marcar como leído" (localStorage,
 * `notificaciones-leidas.ts`): si ya se leyeron todas las de tipo
 * "atención", no se muestra aunque `calcularAlertas` las siga calculando.
 */
export default function Notificaciones({ alertas }: { alertas: Alerta[] }) {
  const leidas = useSyncExternalStore(suscribirCambiosLeidas, leerLeidas, () => SIN_LEIDAS);
  const hayAtencion = alertas.some((a) => a.tipo === 'atencion' && !leidas.has(claveAlerta(a)));

  return (
    <Link href="/admin/notificaciones"
      className="relative w-9 h-9 rounded-lg hairline flex items-center justify-center hover:opacity-70 transition-opacity shrink-0"
      style={{ background: 'var(--surface)' }}>
      <Bell width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
      {hayAtencion && (
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-bad)' }} />
      )}
    </Link>
  );
}
