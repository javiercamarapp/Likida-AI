import Link from 'next/link';
import { CircleCheck, CircleAlert, TriangleAlert } from 'lucide-react';
import type { ResultadoPreflight } from '@/lib/likida/conductor/preflight_piloto';

// ═══════════════════════════════════════════════════════════════════════════
// «¿ESTÁ LISTA LA FLOTA?» (T-A5-25). Presentación pura del preflight del piloto: sin hooks ni datos propios (el servidor
// lee y juzga). `null` = no se pudo leer: se dice, no se pinta una lista en verde ni en rojo inventada.
// ═══════════════════════════════════════════════════════════════════════════

export function PanelPreflight({ preflight }: { preflight: ResultadoPreflight | null }) {
  if (preflight === null) {
    return (
      <section className="card p-4 space-y-2" aria-labelledby="cfg-preflight">
        <h2 id="cfg-preflight" className="font-display text-[15px] font-semibold">¿Está lista la flota?</h2>
        <p role="alert" className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--bad)' }}>
          <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          No se pudo revisar si la flota está lista ahora mismo; intenta de nuevo en un momento.
        </p>
      </section>
    );
  }
  const n = preflight.bloqueos.length;
  return (
    <section className="card p-4 space-y-3" aria-labelledby="cfg-preflight">
      <h2 id="cfg-preflight" className="font-display text-[15px] font-semibold">¿Está lista la flota?</h2>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {preflight.lista
          ? 'Todo en orden: ya se puede encender la pregunta «¿sigues bien?» (señal de vida).'
          : `Falta${n === 1 ? '' : 'n'} ${n} cosa${n === 1 ? '' : 's'} antes de poder encender la pregunta «¿sigues bien?» (señal de vida). Mientras tanto, los hitos se siguen pidiendo por WhatsApp.`}
      </p>
      <ul className="space-y-2">
        {preflight.comprobaciones.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
            {c.estado === 'ok'
              ? <CircleCheck aria-label="En orden" width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
              : <CircleAlert aria-label="Falta" width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--bad)' }} />}
            <span>
              <span className="font-medium">{c.titulo}.</span> {c.detalle}
              {c.queHacer && <span className="block text-[11.5px]" style={{ color: 'var(--faint)' }}>Qué hacer: {c.queHacer}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** El aviso del tablero: solo aparece si hay algo en rojo. Todo en verde (o sin lectura) = no se pinta nada. */
export function BannerPreflight({ preflight, sufijo = '' }: { preflight: ResultadoPreflight | null; sufijo?: string }) {
  if (preflight === null || preflight.lista) return null;
  const n = preflight.bloqueos.length;
  return (
    <p role="status" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
      <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <span>
        La flota aún no está lista para la señal de vida: {n === 1 ? 'falta 1 cosa' : `faltan ${n} cosas`}. {preflight.bloqueos[0].detalle}{' '}
        <Link href={`/dashboard/agentes/conductores/configuracion${sufijo}#cfg-preflight`} className="underline">Ver qué falta</Link>
      </span>
    </p>
  );
}
