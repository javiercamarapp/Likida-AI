import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';

/** La pill de plazo — compartida entre la vista (server) y la cola del jefe
 *  (client): dos copias de un semáforo se desincronizan. */
export function PillPlazo({ c }: { c: TicketPorFacturar['caducidad'] }) {
  const estilo = (fg: string, bg: string) => ({ color: fg, background: bg });
  if (c.vencido) {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--bad)', 'var(--badbg)')}>Vencido</span>;
  }
  if (c.desconocido) {
    // Sin fecha de ticket confiable no se afirma un plazo — se dice.
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--muted)', 'var(--canvas)')}>Plazo sin verificar</span>;
  }
  if (c.urgente) {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--warn)', 'var(--warnbg)')}>{c.diasRestantes} d</span>;
  }
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo('var(--ok)', 'var(--okbg)')}>{c.diasRestantes} d</span>;
}
