import { Receipt } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Cobranza / Facturas — Likida cobrando a SUS clientes (no confundir con
 * `gasto`: los comprobantes de gasto de un viaje son recibos del conductor,
 * un concepto totalmente distinto). No existe tabla de facturación/Stripe,
 * ni de dunning/cobranza — así que esta página es honestamente casi toda
 * empty-state: no hay una sola cifra real que enseñar hoy, y no se inventa
 * ninguna para rellenar. Se explica claro, una vez, en un solo panel.
 */
export default function CobranzaPage() {
  const porVenir = [
    'Monto facturado y cobrado',
    'Facturas por estatus — pendiente, pagada, vencida',
    'DSO (días de cobro)',
    'Tasa de recuperación de vencidos',
    'Recordatorios enviados vs. pagos gatillados',
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center gap-2.5 px-5">
        <Receipt width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Cobranza / Facturas</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <div className="p-6">
          {/* EstadoVacio (design system v2, ui/kit.tsx) — mismo icono-en-caja +
              mensaje que antes, presentación consolidada, misma redacción
              honesta sin cambiar una palabra. */}
          <EstadoVacio icono={<Receipt width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
            <span className="font-semibold">Sin facturación todavía.</span> Likida no cobra a ningún cliente
            todavía — esta página se llena en cuanto exista facturación real (Fase 3 del roadmap).
          </EstadoVacio>
        </div>

        <div className="px-6 pb-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
            Qué va a mostrar esta página cuando exista
          </div>
          <ul className="space-y-2 text-sm">
            {porVenir.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ background: 'var(--muted)' }} />
                <span style={{ color: 'var(--muted)' }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
