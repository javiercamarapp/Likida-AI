import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { mxn, fechaMx } from '@/lib/utils';
import { Boton, CampoSelect } from '@/app/ui-v2/componentes';
import './combustible.css';
import type { LineaPorConciliar } from '@/lib/likida/analytics';

// La pantalla que faltaba desde la 0076 (auditoría 10, hallazgo CRÍTICO
// fiscal): `cfdi_consolidado_linea` ya guardaba la cola de líneas que el JOIN
// automático no pudo ligar solo, con sus candidatos en JSON — pero ninguna
// pantalla dejaba a un humano resolverla. Cada línea de aquí es una fila de
// esa cola, y el `<form>` de abajo llama a `resolverLineaAMano`
// (`intake/consolidado.ts`) vía la Server Action que pasa `combustible-
// casetas/page.tsx`, siguiendo el mismo patrón que `incidencias/vista.tsx`
// (forms server-rendered, sin JS de cliente).

/** El valor del `<option>` que significa "ningún candidato es el correcto" —
 *  nunca choca con un `gastoId` real porque no tiene forma de UUID. Se
 *  exporta para que la Server Action en `page.tsx` sepa distinguirlo de un
 *  `gastoId` sin tener que importar lógica de `intake/consolidado.ts` aquí. */
export const NINGUNO_VALOR = '__ninguno__';

/** Por qué una línea NO se ligó sola, en una frase — la misma distinción que
 *  hace `conciliarLineas`: cero candidatos es "nadie cuadra", dos o más es
 *  "cuadran varios y no se adivina cuál". */
function motivoPorConciliar(tr: Tr, n: number): string {
  if (n === 0) return tr('combustibleCasetas.vistaConsolidado.sinCandidatoNingunGasto');
  return tr('combustibleCasetas.vistaConsolidado.candidatosCuadranVariosPor', { n });
}

export function LineasPorConciliar({
  lineas, accion, tr = trEs,
}: {
  lineas: LineaPorConciliar[];
  accion: (fd: FormData) => Promise<void>; tr?: Tr;
}) {
  if (lineas.length === 0) return null;

  return (
    <ul className="rv-comb__lineas" aria-label={tr('combustibleCasetas.vistaConsolidado.lineasPorResolverA')}>
      {lineas.map((l) => (
        <li key={l.id} className="rv-comb__linea">
          <strong className="rv-comb__monto">{mxn(l.monto)}</strong>
          <span className="rv-comb__tenue">
            {l.fecha ? fechaMx(l.fecha) : tr('combustibleCasetas.vistaConsolidado.sinFechaEnEl')}
            {l.estacionRfc ? ' ' + tr('combustibleCasetas.vistaConsolidado.estacion', { estacionRfc: l.estacionRfc }) : ''}
            {l.folioOperacion ? ' ' + tr('combustibleCasetas.vistaConsolidado.folio', { folioOperacion: l.folioOperacion }) : ''}
            {l.descripcion ? ` · ${l.descripcion}` : ''}
          </span>
          {l.cfdiUuid && (
            <span className="rv-comb__tenue rv-comb__mono">{tr('combustibleCasetas.vistaConsolidado.cfdiLinea', { cfdiUuid: l.cfdiUuid, indice: l.indice })}</span>
          )}

          <span className="rv-comb__tenue">
            {motivoPorConciliar(tr, l.candidatos.length)}
            {l.candidatos.length > 0 && ': ' + l.candidatos
              .map((c) => tr('combustibleCasetas.vistaConsolidado.viaje2', { v: c.viajeFolio ?? tr('combustibleCasetas.vistaConsolidado.sinFolio'), v2: mxn(c.monto), v3: c.fecha ? fechaMx(c.fecha) : tr('combustibleCasetas.vistaConsolidado.sinFecha') }))
              .join(' · ')}
          </span>

          <form action={accion} className="rv-comb__forma">
            <input type="hidden" name="lineaId" value={l.id} />
            {/* A37-S17-01: con VARIOS candidatos empatados no se adivina cuál: nada viene preseleccionado y hay que elegir. */}
            <CampoSelect
              name="eleccion"
              etiqueta={tr('combustibleCasetas.vistaConsolidado.conQueGastoLigar')}
              etiquetaOculta
              required
              defaultValue={l.candidatos.length === 0 ? NINGUNO_VALOR : l.candidatos.length === 1 ? l.candidatos[0].gastoId : ''}
            >
              {l.candidatos.length > 1 && <option value="" disabled>{tr('combustibleCasetas.vistaConsolidado.eligeConQueGasto')}</option>}
              {l.candidatos.map((c) => (
                <option key={c.gastoId} value={c.gastoId}>
                  {tr('combustibleCasetas.vistaConsolidado.viaje', { v: c.viajeFolio ?? tr('combustibleCasetas.vistaConsolidado.sinFolio'), v2: mxn(c.monto), v3: c.fecha ? fechaMx(c.fecha) : tr('combustibleCasetas.vistaConsolidado.sinFecha') })}
                </option>
              ))}
              <option value={NINGUNO_VALOR}>{tr('combustibleCasetas.vistaConsolidado.ningunoDeEstosNo')}</option>
            </CampoSelect>
            <Boton type="submit" variante="primary">{tr('combustibleCasetas.vistaConsolidado.resolver')}</Boton>
          </form>
        </li>
      ))}
    </ul>
  );
}
