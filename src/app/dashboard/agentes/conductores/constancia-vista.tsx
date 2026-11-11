import { numero } from '@/lib/formato';
import './conductores.css';
import { Tarjeta } from '@/app/ui-v2/componentes';
import { csvConstancia, type Constancia, type EstadoConstanciaOperador } from '@/lib/likida/conductor/constancia';
import type { TipoHito } from '@/lib/likida/conductor/tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-67 — LA CONSTANCIA DE REPORTES POR OPERADOR (presentación pura; no lee nada).
//
// Evidencia para monitoreo y RH: hitos reportados frente a esperados en el periodo, con su CSV. NO calcula ni insinúa el bono: eso es de RH.
// Un periodo sin viajes dice que no hay datos; no pinta un 0.
// ═══════════════════════════════════════════════════════════════════════════

export const TEXTO_CONSTANCIA_VACIA = 'No hay viajes con hitos en este periodo, así que no hay nada que constatar.';

const HITO: Record<TipoHito, string> = {
  llegada_carga: 'llegada a carga', salida_carga: 'salida de carga', llegada_descarga: 'llegada a descarga', salida_descarga: 'salida de descarga', regreso: 'regreso',
};
const ESTADO: Record<EstadoConstanciaOperador, string> = {
  completo: 'Completo', completo_con_apoyo: 'Completo con apoyo de oficina o sistema', con_faltantes: 'Con faltantes', en_curso: 'En curso', sin_dato: 'Sin dato',
};

export function ConstanciaReportes({ constancia, dias, hayMas }: { constancia: Constancia; dias: number; hayMas: boolean }) {
  return (
    <Tarjeta titulo={`Constancia de reportes por operador · últimos ${numero(dias)} ${dias === 1 ? 'día' : 'días'}`}
      acciones={!constancia.vacio ? (
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvConstancia(constancia))}`} download="constancia-de-reportes.csv" className="rv-cd__enlace">
          Descargar constancia (CSV)
        </a>
      ) : undefined}>
      <div className="rv-cd__pila">
        {constancia.vacio ? (
          <p className="rv-cd__nota">{TEXTO_CONSTANCIA_VACIA}</p>
        ) : (
          <ul className="rv-cd__lista">
            {constancia.operadores.map((o) => (
              <li key={o.operadorId} className="rv-cd__bloque">
                <div className="rv-cd__linea">
                  <span className="rv-cd__medio">{o.operadorNombre ?? 'Operador sin nombre'}</span>
                  <span className="rv-cd__muted">{ESTADO[o.estado]}</span>
                  {o.estado !== 'sin_dato' && (
                    <span><span className="cifra-mono">{numero(o.reportados)} de {numero(o.esperados)}</span> hitos reportados en {numero(o.viajes)} {o.viajes === 1 ? 'viaje' : 'viajes'}</span>
                  )}
                  {o.estado !== 'sin_dato' && (
                    <span className="rv-cd__muted">
                      {numero(o.reportadosPorOperador)} por el operador · {numero(o.cubiertosPorOficinaOSistema)} {o.cubiertosPorOficinaOSistema === 1 ? 'cubierto' : 'cubiertos'} por oficina o sistema
                    </span>
                  )}
                  {o.pendientes > 0 && <span className="rv-cd__muted">{numero(o.pendientes)} pendientes (viaje en curso)</span>}
                </div>
                {o.faltantesLista.length > 0 && (
                  <p className="rv-cd__nota" data-tono="warn">
                    Sin reportar: {o.faltantesLista.map((f) => `${f.folio ?? 'sin folio'} · ${HITO[f.tipo]}`).join('; ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {hayMas && <p className="rv-cd__nota" data-tono="warn">Hay más viajes en el periodo de los que se leyeron: acorta el periodo para ver el resto.</p>}
        <p className="rv-cd__micro">Es la evidencia de lo que se reportó y por qué medio; no decide ningún pago. «Pendiente» = el viaje sigue abierto.</p>
      </div>
    </Tarjeta>
  );
}
