import { LifeBuoy, Info } from 'lucide-react';

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
          <div className="card p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
              </div>
              <p className="text-sm">
                Tickets abiertos, tiempo de primera respuesta, % de SLA cumplido, cola por prioridad, macros/respuestas
                guardadas — Likida no tiene un sistema de tickets hoy. Con 0 clientes reales, tampoco hay soporte que
                atender todavía.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
