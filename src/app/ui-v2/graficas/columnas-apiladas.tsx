'use client';

import type { Matiz } from '../metricas';
import { TablaGrafica } from './partes';
import { useT } from '@/lib/i18n/proveedor';
import { graficas as graficasEs } from '@/lib/i18n/es/graficas';

export interface PeriodoApilado {
  etiqueta: string;
  /** Una parte por serie (fase o canal), en el orden de `series`; null ⇒ sin dato (no se pinta ni suma como cero). */
  partes: ReadonlyArray<number | null>;
}

/** Columnas apiladas de UN matiz (tonos 100/72/52/34/20 %) por fase o canal. Cada columna mide su total contra el mayor; cada tramo lleva
 *  su cifra en el `title` y en «Ver como tabla», y la leyenda nombra cada serie (el tono nunca es la única señal). Nulos no se pintan. */
export function ColumnasApiladas({ periodos, series, matiz = 8, etiqueta, formato = (v) => String(v), alto = 168 }: {
  periodos: readonly PeriodoApilado[];
  series: readonly string[];
  matiz?: Matiz;
  etiqueta: string;
  formato?: (v: number) => string;
  alto?: number;
}) {
  const { t } = useT('graficas', graficasEs);
  const totales = periodos.map((p) => p.partes.reduce<number>((s, v) => s + (v !== null && v > 0 ? v : 0), 0));
  const max = Math.max(0, ...totales);
  if (max <= 0) {
    return <figure className="rv-gr rv-apcol" data-matiz={matiz} data-vacio aria-label={etiqueta}><p className="rv-apcol__vacio">{t('vacio')}</p></figure>;
  }
  return (
    <figure className="rv-gr rv-apcol" data-matiz={matiz} aria-label={etiqueta}>
      <ul className="rv-apcol__leyenda">
        {series.map((s, i) => <li key={s}><i className={`rv-dona__marca rv-tono-${Math.min(i, 4)}`} aria-hidden="true" />{s}</li>)}
      </ul>
      <div className="rv-apcol__plano" role="img" aria-label={etiqueta} style={{ height: alto }}>
        {periodos.map((p, k) => (
          <div key={p.etiqueta} className="rv-apcol__col" aria-hidden="true">
            <span className="rv-apcol__total">{totales[k] > 0 ? formato(totales[k]) : '—'}</span>
            <div className="rv-apcol__pila" style={{ height: `${((totales[k] / max) * 100).toFixed(2)}%` }}>
              {p.partes.map((v, i) => (v !== null && v > 0 ? (
                <span key={series[i] ?? i} className={`rv-apcol__tramo rv-tono-${Math.min(i, 4)}`} style={{ flexGrow: v }} title={`${p.etiqueta} · ${series[i] ?? ''}: ${formato(v)}`} />
              ) : null))}
            </div>
            <span className="rv-apcol__etq">{p.etiqueta}</span>
          </div>
        ))}
      </div>
      <TablaGrafica titulo={etiqueta} primera={t('apiladas.periodo')} encabezados={[...series, t('apiladas.total')]}
        filas={periodos.map((p, k) => ({ rotulo: p.etiqueta, celdas: [...series.map((_, i) => (p.partes[i] ?? null) === null ? '—' : formato(p.partes[i] as number)), totales[k] > 0 ? formato(totales[k]) : '—'] }))} />
    </figure>
  );
}
