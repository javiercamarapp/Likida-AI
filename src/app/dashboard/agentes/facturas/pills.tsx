import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';
import { StatusChip } from '@/app/ui-v2/componentes';

/** La pill de plazo — compartida entre la vista (server) y la cola del jefe
 *  (client): dos copias de un semáforo se desincronizan. */
export function PillPlazo({ c }: { c: TicketPorFacturar['caducidad'] }) {
  if (c.vencido) return <StatusChip tono="bad">Vencido</StatusChip>;
  // Sin fecha de ticket confiable no se afirma un plazo — se dice.
  if (c.desconocido) return <StatusChip tono="muted">Plazo sin verificar</StatusChip>;
  if (c.urgente) return <StatusChip tono="warn">{c.diasRestantes} d</StatusChip>;
  return <StatusChip tono="ok">{c.diasRestantes} d</StatusChip>;
}
