import { numero } from '@/lib/formato';
import './conductores.css';
import { Tarjeta } from '@/app/ui-v2/componentes';
import { csvConstancia, type Constancia, type EstadoConstanciaOperador } from '@/lib/likida/conductor/constancia';
import type { TipoHito } from '@/lib/likida/conductor/tipos';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-67 — LA CONSTANCIA DE REPORTES POR OPERADOR (presentación pura; no lee nada).
//
// Evidencia para monitoreo y RH: hitos reportados frente a esperados en el periodo, con su CSV. NO calcula ni insinúa el bono: eso es de RH.
// Un periodo sin viajes dice que no hay datos; no pinta un 0.
// ═══════════════════════════════════════════════════════════════════════════

export const textoConstanciaVacia = (tx: TAgentes = TR_ES.t) => (tx('rest.no_hay_viajes_con_hitos_en'));
export const TEXTO_CONSTANCIA_VACIA = textoConstanciaVacia();

const HITO: Record<TipoHito, string> = {
  llegada_carga: 'llegada a carga', salida_carga: 'salida de carga', llegada_descarga: 'llegada a descarga', salida_descarga: 'salida de descarga', regreso: 'regreso',
};
const estadoTr = (tx: TAgentes = TR_ES.t): Record<EstadoConstanciaOperador, string> => ({
  completo: tx('rest.completo'), completo_con_apoyo: tx('rest.completo_con_apoyo_de_oficina_o'), con_faltantes: tx('rest.con_faltantes'), en_curso: tx('vigia.vista.est_enviando'), sin_dato: tx('rest.sin_dato'),
});

export function ConstanciaReportes({ constancia, dias, hayMas, tr = TR_ES }: { constancia: Constancia; dias: number; hayMas: boolean; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <Tarjeta titulo={tx(dias === 1 ? 'rest.constancia_de_reportes_ultimos_dias.uno' : 'rest.constancia_de_reportes_ultimos_dias.otros', { n: numero(dias) })}
      acciones={!constancia.vacio ? (
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvConstancia(constancia))}`} download="constancia-de-reportes.csv" className="rv-cd__enlace">{tx('rest.descargar_constancia_csv')}</a>
      ) : undefined}>
      <div className="rv-cd__pila">
        {constancia.vacio ? (
          <p className="rv-cd__nota">{textoConstanciaVacia(tx)}</p>
        ) : (
          <ul className="rv-cd__lista">
            {constancia.operadores.map((o) => (
              <li key={o.operadorId} className="rv-cd__bloque">
                <div className="rv-cd__linea">
                  <span className="rv-cd__medio">{o.operadorNombre ?? tx('cobranza.vista.operador_sin_nombre')}</span>
                  <span className="rv-cd__muted">{estadoTr(tx)[o.estado]}</span>
                  {o.estado !== 'sin_dato' && (
                    <span>{ricoT(tx('rest.e0_de_e0_hitos_reportados_en', { numero: numero(o.reportados), numero2: numero(o.esperados), numero3: numero(o.viajes) }), { e0: (c) => <span className="cifra-mono">{c}</span> })}{' '}{o.viajes === 1 ? 'viaje' : 'viajes'}</span>
                  )}
                  {o.estado !== 'sin_dato' && (
                    <span className="rv-cd__muted">{tx('rest.por_el_operador', { numero: numero(o.reportadosPorOperador), numero2: numero(o.cubiertosPorOficinaOSistema) })}{' '}{o.cubiertosPorOficinaOSistema === 1 ? 'cubierto' : 'cubiertos'}{' '}{tx('rest.por_oficina_o_sistema')}</span>
                  )}
                  {o.pendientes > 0 && <span className="rv-cd__muted">{numero(o.pendientes)}{' '}{tx('rest.pendientes_viaje_en_curso')}</span>}
                </div>
                {o.faltantesLista.length > 0 && (
                  <p className="rv-cd__nota" data-tono="warn">{tx('rest.sin_reportar', { o: o.faltantesLista.map((f) => `${f.folio ?? 'sin folio'} · ${HITO[f.tipo]}`).join('; ') })}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {hayMas && <p className="rv-cd__nota" data-tono="warn">{tx('rest.hay_mas_viajes_en_el_periodo')}</p>}
        <p className="rv-cd__micro">{tx('rest.es_la_evidencia_de_lo_que')}</p>
      </div>
    </Tarjeta>
  );
}
