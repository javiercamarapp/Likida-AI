import { LifeBuoy } from 'lucide-react';
import SeccionPendiente from '../pendiente';

export const dynamic = 'force-dynamic';

export default function SoportePage() {
  return (
    <SeccionPendiente
      Icono={LifeBuoy}
      titulo="Soporte & Quejas"
      subtitulo="Incidencias de tus viajes y reclamaciones de tus clientes"
      falta={
        <>
          No hay tabla de tickets, ni cola, ni reloj de SLA. Nada de lo que esta sección mediría se está
          registrando hoy.
          <br /><br />
          Las incidencias de un viaje (retraso, daño, faltante) tampoco tienen dónde vivir: `viaje` guarda estatus
          y anticipo, no lo que salió mal.
          <br /><br />
          Si necesitas algo de Likida ahora, es por WhatsApp — que es donde ya está tu operación.
        </>
      }
      cuandoExista={[
        'Tickets abiertos, con su prioridad y su reloj de SLA',
        'Quejas por motivo — dónde se repite el problema',
        'Incidencias por viaje: retraso, daño, faltante, con su evidencia',
        'Claims / OS&D con sus plazos legales (9 meses, 120 días)',
        'CSAT: qué tan satisfecho quedó quien levantó la queja',
      ]}
    />
  );
}
