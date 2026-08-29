import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { BarraPagina } from '../../dashboard/resumen-visual';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Comunicación / Broadcast — página enteramente honesta. No existe tabla
 * ni tooling de campañas/broadcast INTERNAS: el único canal de mensajes hoy
 * hacia choferes/flotas sigue siendo el bot de WhatsApp conversando 1 a 1
 * (ver Conversaciones en Inicio y en WhatsApp Infra), no un envío masivo.
 * Esto NO cambió con el estudio de marketing (0266, Fase D): ese es
 * contenido de crecimiento hacia AFUERA (redes sociales, prospección), un
 * dominio distinto — se enlaza abajo para que nadie confunda uno con otro,
 * sin tocar una palabra de la frase honesta de esta página.
 *
 * Re-envuelta en la anatomía de página (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts` — el mismo chrome que el resto de /admin. El
 * mensaje honesto es el mismo de antes, ni una palabra cambiada.
 */
export default function ComunicacionPage() {
  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Megaphone width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Comunicación"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Avisos, campañas y broadcast</p>
          {/* EstadoVacio (kit compartido) — mismo mensaje honesto de antes,
              presentación consolidada, ni una palabra cambiada. Icono por
              defecto (Info), igual que antes. */}
          <EstadoVacio>
            Nuevo aviso/campaña, segmentación, historial de envíos con métricas de apertura, reglas de alertas
            configurables — Likida no tiene un sistema de comunicación masiva INTERNA hoy (avisos a choferes o
            flotas). El único canal de mensajes hacia ellos es el bot de WhatsApp conversando 1 a 1, no un broadcast.
          </EstadoVacio>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Si lo que buscas es contenido de crecimiento hacia afuera — redes sociales, banco de hooks, piezas del
            día con su copy por canal —, eso vive en el{' '}
            <Link href="/admin/marketing" className="underline">estudio de marketing</Link>, un dominio distinto de
            este.
          </p>
        </div>
      </div>
    </main>
  );
}
