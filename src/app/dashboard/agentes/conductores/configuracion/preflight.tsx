import Link from 'next/link';
import { CircleCheck, CircleAlert } from 'lucide-react';
import '../conductores.css';
import { AvisoCompacto, Icono, Tarjeta } from '@/app/ui-v2/componentes';
import type { ResultadoPreflight } from '@/lib/likida/conductor/preflight_piloto';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// «¿ESTÁ LISTA LA FLOTA?» (T-A5-25). Presentación pura del preflight del piloto: sin hooks ni datos propios (el servidor
// lee y juzga). `null` = no se pudo leer: se dice, no se pinta una lista en verde ni en rojo inventada.
// ═══════════════════════════════════════════════════════════════════════════

export function PanelPreflight({ preflight, tr = TR_ES }: { preflight: ResultadoPreflight | null; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (preflight === null) {
    return (
      <section id="cfg-preflight">
        <Tarjeta titulo={tx('rest.esta_lista_la_flota')} estado="error" mensaje={tx('rest.no_se_pudo_revisar_si_la')} />
      </section>
    );
  }
  const n = preflight.bloqueos.length;
  return (
    <section id="cfg-preflight">
      <Tarjeta titulo={tx('rest.esta_lista_la_flota')}>
        <div className="rv-cd__pila">
          <p className="rv-cd__nota">
            {preflight.lista
              ? tx('rest.todo_en_orden_ya_se_puede')
              : tx(n === 1 ? 'rest.falta_n_cosa_antes_de_encender.uno' : 'rest.falta_n_cosa_antes_de_encender.otros', { n })}
          </p>
          <ul className="rv-cd__lista">
            {preflight.comprobaciones.map((c) => (
              <li key={c.id} className="rv-cd__icono-linea" data-tono={c.estado === 'ok' ? 'ok' : undefined}>
                <Icono icono={c.estado === 'ok' ? CircleCheck : CircleAlert} tam={16} etiqueta={c.estado === 'ok' ? tx('rest.en_orden') : tx('rest.falta')} />
                <span>
                  <span className="rv-cd__medio">{c.titulo}.</span> {c.detalle}
                  {c.queHacer && <span className="rv-cd__micro rv-cd__bloquear">{tx('vigia.vista.que_hacer')}{' '}{c.queHacer}</span>}
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
export function BannerPreflight({ preflight, sufijo = '', tr = TR_ES }: { preflight: ResultadoPreflight | null; sufijo?: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (preflight === null || preflight.lista) return null;
  const n = preflight.bloqueos.length;
  return (
    <AvisoCompacto tono="warn" resumen={
      <>{tx('rest.la_flota_aun_no_esta_lista')}{' '}{n === 1 ? 'falta 1 cosa' : `faltan ${n} cosas`}{ricoT(tx('rest.e0_ver_que_falta_e0', { detalle: preflight.bloqueos[0].detalle }), { e0: (c) => <Link href={`/dashboard/agentes/conductores/configuracion${sufijo}#cfg-preflight`} className="rv-cd__enlace">{c}</Link> })}</>
    } />
  );
}
