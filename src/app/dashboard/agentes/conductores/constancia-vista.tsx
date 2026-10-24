import { numero } from '@/lib/formato';
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
    <section className="card p-4 space-y-3" aria-label="Constancia de reportes por operador">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-display text-[15px] font-semibold mr-2">Constancia de reportes por operador</h2>
        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>últimos {numero(dias)} {dias === 1 ? 'día' : 'días'}</span>
        {!constancia.vacio && (
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvConstancia(constancia))}`} download="constancia-de-reportes.csv" className="text-[12px] underline" style={{ color: 'var(--muted)' }}>
            Descargar constancia (CSV)
          </a>
        )}
      </div>
      {constancia.vacio ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{TEXTO_CONSTANCIA_VACIA}</p>
      ) : (
        <ul className="space-y-1.5">
          {constancia.operadores.map((o) => (
            <li key={o.operadorId} className="hairline rounded-lg p-2.5 text-[12.5px] space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="font-medium">{o.operadorNombre ?? 'Operador sin nombre'}</span>
                <span style={{ color: 'var(--muted)' }}>{ESTADO[o.estado]}</span>
                {o.estado !== 'sin_dato' && (
                  <span><span className="cifra-mono">{numero(o.reportados)} de {numero(o.esperados)}</span> hitos reportados en {numero(o.viajes)} {o.viajes === 1 ? 'viaje' : 'viajes'}</span>
                )}
                {o.estado !== 'sin_dato' && (
                  <span style={{ color: 'var(--muted)' }}>
                    {numero(o.reportadosPorOperador)} por el operador · {numero(o.cubiertosPorOficinaOSistema)} {o.cubiertosPorOficinaOSistema === 1 ? 'cubierto' : 'cubiertos'} por oficina o sistema
                  </span>
                )}
                {o.pendientes > 0 && <span style={{ color: 'var(--muted)' }}>{numero(o.pendientes)} pendientes (viaje en curso)</span>}
              </div>
              {o.faltantesLista.length > 0 && (
                <p style={{ color: 'var(--warn)' }}>
                  Sin reportar: {o.faltantesLista.map((f) => `${f.folio ?? 'sin folio'} · ${HITO[f.tipo]}`).join('; ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {hayMas && <p className="text-[12px]" style={{ color: 'var(--warn)' }}>Hay más viajes en el periodo de los que se leyeron: acorta el periodo para ver el resto.</p>}
      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Es la evidencia de lo que se reportó y por qué medio; no decide ningún pago. «Pendiente» = el viaje sigue abierto.</p>
    </section>
  );
}
