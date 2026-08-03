import { Megaphone } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Comunicación / Broadcast — página enteramente honesta. No existe tabla
 * ni tooling de campañas/broadcast: el único canal de mensajes hoy es el
 * bot de WhatsApp conversando 1 a 1 con cada chofer (ver Conversaciones en
 * Inicio y en WhatsApp Infra), no un envío masivo.
 */
export default function ComunicacionPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Megaphone width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Comunicación</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Avisos, campañas y broadcast</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          {/* EstadoVacio (design system v2, ui/kit.tsx) — mismo icono-en-caja +
              mensaje honesto de antes, presentación consolidada, ni una
              palabra cambiada. Icono por defecto (Info), igual que antes. */}
          <EstadoVacio>
            Nuevo aviso/campaña, segmentación, historial de envíos con métricas de apertura, reglas de alertas
            configurables — Likida no tiene un sistema de comunicación masiva hoy. El único canal de mensajes es
            el bot de WhatsApp conversando 1 a 1 con cada chofer, no un broadcast.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
