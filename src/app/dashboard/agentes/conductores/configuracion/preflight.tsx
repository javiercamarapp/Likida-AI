import Link from 'next/link';
import { CircleCheck, CircleAlert } from 'lucide-react';
import '../conductores.css';
import { AvisoCompacto, Icono, Tarjeta } from '@/app/ui-v2/componentes';
import type { ResultadoPreflight } from '@/lib/likida/conductor/preflight_piloto';

// ═══════════════════════════════════════════════════════════════════════════
// «¿ESTÁ LISTA LA FLOTA?» (T-A5-25). Presentación pura del preflight del piloto: sin hooks ni datos propios (el servidor
// lee y juzga). `null` = no se pudo leer: se dice, no se pinta una lista en verde ni en rojo inventada.
// ═══════════════════════════════════════════════════════════════════════════

export function PanelPreflight({ preflight }: { preflight: ResultadoPreflight | null }) {
  if (preflight === null) {
    return (
      <section id="cfg-preflight">
        <Tarjeta titulo="¿Está lista la flota?" estado="error" mensaje="No se pudo revisar si la flota está lista ahora mismo; intenta de nuevo en un momento." />
      </section>
    );
  }
  const n = preflight.bloqueos.length;
  return (
    <section id="cfg-preflight">
      <Tarjeta titulo="¿Está lista la flota?">
        <div className="rv-cd__pila">
          <p className="rv-cd__nota">
            {preflight.lista
              ? 'Todo en orden: ya se puede encender la pregunta «¿sigues bien?» (señal de vida).'
              : `Falta${n === 1 ? '' : 'n'} ${n} cosa${n === 1 ? '' : 's'} antes de poder encender la pregunta «¿sigues bien?» (señal de vida). Mientras tanto, los hitos se siguen pidiendo por WhatsApp.`}
          </p>
          <ul className="rv-cd__lista">
            {preflight.comprobaciones.map((c) => (
              <li key={c.id} className="rv-cd__icono-linea" data-tono={c.estado === 'ok' ? 'ok' : undefined}>
                <Icono icono={c.estado === 'ok' ? CircleCheck : CircleAlert} tam={16} etiqueta={c.estado === 'ok' ? 'En orden' : 'Falta'} />
                <span>
                  <span className="rv-cd__medio">{c.titulo}.</span> {c.detalle}
                  {c.queHacer && <span className="rv-cd__micro rv-cd__bloquear">Qué hacer: {c.queHacer}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Tarjeta>
    </section>
  );
}

/** El aviso del tablero: solo aparece si hay algo en rojo. Todo en verde (o sin lectura) = no se pinta nada. */
export function BannerPreflight({ preflight, sufijo = '' }: { preflight: ResultadoPreflight | null; sufijo?: string }) {
  if (preflight === null || preflight.lista) return null;
  const n = preflight.bloqueos.length;
  return (
    <AvisoCompacto tono="warn" resumen={
      <>
        La flota aún no está lista para la señal de vida: {n === 1 ? 'falta 1 cosa' : `faltan ${n} cosas`}. {preflight.bloqueos[0].detalle}{' '}
        <Link href={`/dashboard/agentes/conductores/configuracion${sufijo}#cfg-preflight`} className="rv-cd__enlace">Ver qué falta</Link>
      </>
    } />
  );
}
