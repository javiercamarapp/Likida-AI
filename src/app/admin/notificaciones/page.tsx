import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
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
  const [r, conversaciones] = await Promise.all([getResumenNegocio(), getConversacionesActivas()]);
  const alertas = calcularAlertas(r, conversaciones);

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
