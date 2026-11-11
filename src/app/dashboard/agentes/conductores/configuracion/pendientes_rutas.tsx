'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso, type AccionSitio } from '../sitios/formas';
import type { PendienteRevision } from '@/lib/likida/conductor/rutas';
import '../conductores.css';
import { Boton } from '@/app/ui-v2/componentes';

// ═══════════════════════════════════════════════════════════════════════════
// MANTENIMIENTO DE RUTAS (T-A5-50): las rutas autorizadas que llevan tiempo sin revisarse, de la más descuidada a la menos,
// con el botón «Revisada». Solo muestra y marca: no envía mensajes ni programa nada. El link se muestra tal cual está guardado.
// ═══════════════════════════════════════════════════════════════════════════

/** Fila ya serializable (la página la arma desde `rutasPendientesDeRevision`). */
export type FilaPendienteRuta = PendienteRevision;

function Revisada() {
  const { pending } = useFormStatus();
  return <Boton type="submit" tamano="sm" loading={pending}>{pending ? 'Marcando…' : 'Revisada'}</Boton>;
}

const textoSitios = (r: FilaPendienteRuta['ruta']): string => {
  if (r.sitioOrigen && r.sitioDestino) return `de ${r.sitioOrigen} a ${r.sitioDestino}`;
  if (r.sitioOrigen) return `origen ${r.sitioOrigen}`;
  if (r.sitioDestino) return `destino ${r.sitioDestino}`;
  return 'corredor completo';
};

const textoAntiguedad = (dias: number | null): string =>
  dias === null ? 'Nunca se ha revisado' : `Sin revisar hace ${dias} día${dias === 1 ? '' : 's'}`;

function Fila({ p, accion }: { p: FilaPendienteRuta; accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <li className="rv-cd__item">
      <form action={enviar} className="rv-cd__linea" aria-label={`Marcar revisada la ruta ${p.ruta.corredor}`}>
        <input type="hidden" name="id" value={p.ruta.id} />
        <div>
          <div><span className="rv-cd__medio">{p.ruta.corredor}</span> <span className="rv-cd__muted">· {textoSitios(p.ruta)}</span></div>
          <div className="rv-cd__nota">
            {textoAntiguedad(p.diasSinRevisar)}{p.vencida ? ' · vencida: el chofer no la recibe hasta que la renueves' : ''}
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
  if (pendientes.length === 0) {
    return (
      <p role="status" className="rv-cd__nota">
        {totalRutas === 0
          ? 'Todavía no hay rutas cargadas; cuando importes las primeras, aquí verás cuáles necesitan revisión.'
          : `Todas las rutas se revisaron en los últimos ${dias} días. No hay nada pendiente.`}
      </p>
    );
  }
  return (
    <div className="rv-cd__pila--s">
      <p className="rv-cd__nota">
        {pendientes.length} ruta{pendientes.length === 1 ? '' : 's'} sin revisar en {dias} días o más. Ábrela en Google Maps, confirma que sigue bien y marca «Revisada».
      </p>
      <ul className="rv-cd__lista" aria-label="Rutas pendientes de revisión">
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
