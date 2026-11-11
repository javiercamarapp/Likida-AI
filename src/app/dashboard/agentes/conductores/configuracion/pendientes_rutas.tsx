'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso, type AccionSitio } from '../sitios/formas';
import type { PendienteRevision } from '@/lib/likida/conductor/rutas';
import '../conductores.css';
import { Boton } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// MANTENIMIENTO DE RUTAS (T-A5-50): las rutas autorizadas que llevan tiempo sin revisarse, de la más descuidada a la menos,
// con el botón «Revisada». Solo muestra y marca: no envía mensajes ni programa nada. El link se muestra tal cual está guardado.
// ═══════════════════════════════════════════════════════════════════════════

/** Fila ya serializable (la página la arma desde `rutasPendientesDeRevision`). */
export type FilaPendienteRuta = PendienteRevision;

function Revisada() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return <Boton type="submit" tamano="sm" loading={pending}>{pending ? 'Marcando…' : tx('rest.revisada')}</Boton>;
}

const textoSitios = (r: FilaPendienteRuta['ruta']): string => {
  if (r.sitioOrigen && r.sitioDestino) return `de ${r.sitioOrigen} a ${r.sitioDestino}`;
  if (r.sitioOrigen) return `origen ${r.sitioOrigen}`;
  if (r.sitioDestino) return `destino ${r.sitioDestino}`;
  return 'corredor completo';
};

const textoAntiguedad = (dias: number | null, tx: TAgentes = TR_ES.t): string =>
  dias === null ? tx('rest.nunca_se_ha_revisado') : tx(dias === 1 ? 'rest.sin_revisar_hace_n_dias.uno' : 'rest.sin_revisar_hace_n_dias.otros', { n: dias });

function Fila({ p, accion }: { p: FilaPendienteRuta; accion: AccionSitio }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <li className="rv-cd__item">
      <form action={enviar} className="rv-cd__linea" aria-label={`Marcar revisada la ruta ${p.ruta.corredor}`}>
        <input type="hidden" name="id" value={p.ruta.id} />
        <div>
          <div><span className="rv-cd__medio">{p.ruta.corredor}</span> <span className="rv-cd__muted">· {textoSitios(p.ruta)}</span></div>
          <div className="rv-cd__nota">
            {textoAntiguedad(p.diasSinRevisar)}{p.vencida ? tx('rest.vencida_el_chofer_no_la_recibe') : ''}
          </div>
        </div>
        <span className="rv-cd__fin"><Revisada /></span>
      </form>
      <Aviso r={estado} />
    </li>
  );
}

export function PendientesRutas({ pendientes, totalRutas, dias, accionRevisada }: {
  pendientes: FilaPendienteRuta[]; totalRutas: number; dias: number; accionRevisada?: AccionSitio;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  if (pendientes.length === 0) {
    return (
      <p role="status" className="rv-cd__nota">
        {totalRutas === 0
          ? tx('rest.todavia_no_hay_rutas_cargadas_cuando')
          : tx('rest.todas_las_rutas_se_revisaron_en', { dias })}
      </p>
    );
  }
  return (
    <div className="rv-cd__pila--s">
      <p className="rv-cd__nota">
        {tx(pendientes.length === 1 ? 'rest.n_ruta_sin_revisar_en_dias.uno' : 'rest.n_ruta_sin_revisar_en_dias.otros', { n: pendientes.length, dias })}</p>
      <ul className="rv-cd__lista" aria-label={tx('rest.rutas_pendientes_de_revision')}>
        {pendientes.map((p) => (accionRevisada
          ? <Fila key={p.ruta.id} p={p} accion={accionRevisada} />
          : (
            <li key={p.ruta.id} className="rv-cd__item">
              <div><span className="rv-cd__medio">{p.ruta.corredor}</span> <span className="rv-cd__muted">· {textoSitios(p.ruta)}</span></div>
              <div className="rv-cd__nota">{textoAntiguedad(p.diasSinRevisar)}{p.vencida ? ' · vencida' : ''}</div>
            </li>
          )))}
      </ul>
    </div>
  );
}
