import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas, contarConversacionesActivas } from '@/lib/admin/negocio';
import { getBandejaEscalaciones, type ConteosEscalaciones } from '@/lib/admin/escalaciones';
import { ahoraMs } from '@/lib/saludo';
import { calcularAlertas } from '../calcular-alertas';
import { Bell } from 'lucide-react';
import NotificacionesLista from './lista';

export const dynamic = 'force-dynamic';

const CONTEOS_CIEGOS: ConteosEscalaciones = {
  arco: null, corridasFallo: null, talachas: null, facturasProveedor: null,
  ticketsAbiertos: null, ticketsVencidos: null, liquidacionesRevisar: null,
};

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
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // La bandeja de escalaciones alimenta la campana con los MISMOS conteos
  // que pinta /admin/escalaciones (nunca lanza: una fuente ilegible llega
  // como null y calcularAlertas la reporta como fuente ciega).
  // A37-S07-07: cada fuente degrada POR SEPARADO. Un `Promise.all` sin catch
  // tumbaba la página entera si cualquiera fallaba; ahora una fuente ilegible
  // se dice en una alerta («No se pudo leer…») y el resto sigue.
  const [rr, cr, br, tr] = await Promise.allSettled([
    getResumenNegocio(), getConversacionesActivas(), getBandejaEscalaciones(ahoraMs()),
    // FE-9: el total real, no el tamaño de la página de 20.
    contarConversacionesActivas(),
  ]);
  const ciegas: string[] = [];
  const r = rr.status === 'fulfilled' ? rr.value : null;
  if (r === null) ciegas.push('resumen del negocio (costo de IA y flotas)');
  const conversaciones = cr.status === 'fulfilled' ? cr.value : [];
  const conversacionesTotal = tr.status === 'fulfilled' ? tr.value : null;
  if (cr.status === 'rejected' || tr.status === 'rejected') ciegas.push('conversaciones de WhatsApp');
  // Bandeja caída: todos los conteos en null → calcularAlertas ya emite su
  // propia alerta «No se pudo leer: …» por cada fuente ciega.
  const conteos = br.status === 'fulfilled' ? br.value.conteos : CONTEOS_CIEGOS;
  const alertas = calcularAlertas(r, conversaciones, conteos, conversacionesTotal);
  if (ciegas.length > 0) {
    alertas.push({ tipo: 'atencion', texto: `No se pudo leer: ${ciegas.join(', ')} — las alertas de esta página pueden estar incompletas.` });
  }

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
