import { LifeBuoy } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Soporte / Tickets — página enteramente honesta. Likida no tiene un
 * sistema de tickets: sin tabla, sin cola, sin SLA que medir. En vez de
 * simular una bandeja vacía con datos de a mentiras, esto explica en una
 * frase por qué no hay nada que enseñar todavía (0 clientes reales →
 * tampoco hay soporte que atender).
 */
export default function SoportePage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <LifeBuoy width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Soporte</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Tickets, tiempos de respuesta y SLA</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <EstadoVacio>
            Tickets abiertos, tiempo de primera respuesta, % de SLA cumplido, cola por prioridad, macros/respuestas
            guardadas — Likida no tiene un sistema de tickets hoy. Con 0 clientes reales, tampoco hay soporte que
            atender todavía.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
