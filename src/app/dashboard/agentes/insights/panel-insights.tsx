import type { ResultadoComposicion } from '@/lib/likida/insights/componer';
import { EsqTarjeta } from '../../bloque';
import { TarjetaInsight } from './tarjeta-insight';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

// T-INS-03 — Panel de insights con sus cuatro estados: cargando, error, vacío y listo.
// Recibe el resultado ya compuesto por `componer()` (T-INS-02); no decide nada.

export const textoVacio = (t: TResto = T_RESTO_ES) => (t('ch.aun_no_hay_datos_para_interpretar'));
export const TEXTO_VACIO = textoVacio();
export const textoError = (t: TResto = T_RESTO_ES) => (t('ch.no_pudimos_preparar_la_interpretacion_los'));
export const TEXTO_ERROR = textoError();

export type EstadoPanel =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje?: string }
  | { estado: 'listo'; resultado: ResultadoComposicion };

export function PanelInsights({ titulo, t = T_RESTO_ES, ...props }: EstadoPanel & { titulo?: string; t?: TResto }) {
  const rotulo = titulo ?? t('ch.que_paso_y_que_hacer');
  return (
    <section aria-label={rotulo} className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {rotulo}
      </h2>
      <Cuerpo {...props} t={t} />
    </section>
  );
}

function Cuerpo(p: EstadoPanel & { t: TResto }) {
  const { t } = p;
  if (p.estado === 'cargando') {
    return (
      <div aria-busy="true">
        <EsqTarjeta alto={120} />
      </div>
    );
  }
  if (p.estado === 'error') {
    return (
      <div role="alert" className="card p-4 text-sm" style={{ color: 'var(--ink)', borderColor: 'var(--bad)' }}>{rico(t('ch.e0_algo_fallo_e0'), { e0: (c) => <strong style={{ color: 'var(--bad)' }}>{c}</strong> })}{p.mensaje ?? textoError(t)}
      </div>
    );
  }
  const { visibles, verMas, total } = p.resultado;
  if (total === 0) {
    return (
      <p className="card p-4 text-sm" style={{ color: 'var(--muted)' }} data-vacio>
        {textoVacio(t)}
      </p>
    );
  }
  return (
    <>
      <ul className="space-y-2 list-none p-0">
        {visibles.map((i) => (
          <li key={i.id}>
            <TarjetaInsight insight={i} />
          </li>
        ))}
      </ul>
      {verMas.length > 0 && (
        <details>
          <summary className="text-xs font-medium cursor-pointer" style={{ color: 'var(--ink)' }}>{t('ch.ver_mas', { length: verMas.length })}</summary>
          <ul className="space-y-2 list-none p-0 mt-2">
            {verMas.map((i) => (
              <li key={i.id}>
                <TarjetaInsight insight={i} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
