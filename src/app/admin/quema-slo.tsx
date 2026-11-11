import { StatusChip } from '@/app/ui-v2/componentes';
import type { Traductor } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';
import { porcentaje } from '@/lib/formato';
import { evaluarSlosEnQuema, type EvaluacionQuema } from '@/lib/admin/slo-quema';
import './resumen.css';

const TONO = { pagina: 'bad', ticket: 'warn', ninguna: 'ok', sin_medir: 'muted' } as const;

/** Presupuesto de error y quema por objetivo (F14-A). Sin denominador dice «sin medir» con su razón; nunca 0 ni verde de cortesía. */
export function QuemaSlo({ evaluaciones, t }: { evaluaciones: EvaluacionQuema[] | null; t: Traductor<DiccionarioDe<'monitoreo'>>['t'] }) {
  return (
    <section aria-label={t('quema.titulo')}>
      <h3 className="rv-recuadro-tit__texto">{t('quema.titulo')}</h3>
      {evaluaciones === null ? <p className="adm-res-pie">{t('quema.error')}</p> : (
        <ul className="adm-res-lista">
          {evaluaciones.map((e) => (
            <li key={e.clave} className="adm-res-fila">
              <div className="adm-res-fila__texto">
                <span className="adm-res-fila__titulo">{e.nombre}</span>
                <span className="adm-res-fila__detalle">
                  {t('quema.objetivo', { pct: porcentaje(e.objetivo * 100, 0).replace(/\s?%$/, '') })}
                  {e.presupuesto ? ` · ${t('quema.presupuesto', { pct: e.presupuesto.restantePct })}` : ''}
                  {e.razon ? ` · ${e.razon}` : ''}
                </span>
                {e.presupuesto?.agotado ? <span className="adm-res-fila__detalle">{t('quema.agotado')}</span> : null}
              </div>
              <StatusChip tono={TONO[e.nivel]}>{t(`quema.estado.${e.nivel}`)}</StatusChip>
            </li>
          ))}
        </ul>
      )}
      <p className="adm-res-pie">{t('quema.nota')}</p>
    </section>
  );
}

/** Lectura que nunca lanza. */
export async function leerQuema(): Promise<EvaluacionQuema[] | null> {
  try { return await evaluarSlosEnQuema(); } catch { return null; }
}
