import { getResumenNegocio, getConversacionesActivas, contarConversacionesActivas } from '@/lib/admin/negocio';
import { getBandejaEscalaciones } from '@/lib/admin/escalaciones';
import { ahoraMs } from '@/lib/saludo';
import { calcularAlertas } from '../calcular-alertas';
import { Bell } from 'lucide-react';
import NotificacionesLista from './lista';

export const dynamic = 'force-dynamic';

/**
 * Página real de notificaciones — la campana del sidebar ya no abre un
 * dropdown, lleva aquí. Mismas alertas de siempre (`calcularAlertas`,
 * compartida con admin/layout.tsx): tendencia de costo, conversaciones
 * activas, si Likida sigue solo con el tenant demo. Nada inventado — si
 * no hay ninguna condición real, la página dice "Sin novedades", no
 * rellena con contenido de adorno. El renglón interactivo (marcar
 * leído/marcar todas, swipe en móvil) vive en `lista.tsx` (client).
 */
export default async function NotificacionesPage() {
  // La bandeja de escalaciones alimenta la campana con los MISMOS conteos
  // que pinta /admin/escalaciones (nunca lanza: una fuente ilegible llega
  // como null y calcularAlertas la reporta como fuente ciega).
  const [r, conversaciones, bandeja, conversacionesTotal] = await Promise.all([
    getResumenNegocio(), getConversacionesActivas(), getBandejaEscalaciones(ahoraMs()),
    // FE-9: el total real, no el tamaño de la página de 20.
    contarConversacionesActivas(),
  ]);
  const alertas = calcularAlertas(r, conversaciones, bandeja.conteos, conversacionesTotal);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center gap-2.5 px-5">
        <Bell width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Notificaciones</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <NotificacionesLista alertas={alertas} />
      </div>
    </div>
  );
}
