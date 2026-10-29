import Link from 'next/link';
import type { ReactNode } from 'react';
import { numero } from '@/lib/formato';
import { metrica, type MetricaId } from '../metricas';
import { KindBadge, type TipoDato } from './kind-badge';
import { Sparkline } from './sparkline';

export interface SegmentoKpi { etiqueta: string; valor: number | null }

export interface ItemKpi {
  etiqueta: string;
  /** null = sin dato: se pinta «—» y nunca 0. Un número se formatea con lib/formato. */
  valor: string | number | null;
  /** Procedencia en UNA línea («TMS · hace 5 min»). Sin elipsis; bajo 1100 px pasa al tooltip. */
  sello?: string;
  /** @deprecated usa `sello`; se sigue mostrando como sello si no hay uno. */
  nota?: string;
  /** Texto ya formateado, p. ej. «+4,2 %». El color va solo en el chip; la flecha lleva el sentido. */
  delta?: { texto: string; dir: 'sube' | 'baja' | 'igual'; bueno?: 'sube' | 'baja' } | null;
  serie?: ReadonlyArray<number | null>;
  /** Alternativa a la serie: barra segmentada (segmentos de 6 px). Una u otra. */
  segmentos?: readonly SegmentoKpi[];
  /** Icono de 16 px, tintado con el matiz de la métrica. */
  icono?: ReactNode;
  /** Identidad de la métrica (color + clase epistémica por defecto). */
  metrica?: MetricaId;
  /** Matiz de datos 1..8 para el filete de 3 px (si no hay `metrica`). */
  matiz?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  tipo?: TipoDato;
  href?: string;
}

const FLECHA = { sube: '▲', baja: '▼', igual: '■' } as const;
const SENTIDO = { sube: 'sube', baja: 'baja', igual: 'sin cambio' } as const;

function tonoDelta(d: NonNullable<ItemKpi['delta']>): 'ok' | 'bad' | 'neutral' {
  if (d.dir === 'igual' || !d.bueno) return 'neutral';
  return d.dir === d.bueno ? 'ok' : 'bad';
}

/** Tira de KPIs en UNA sola tarjeta (112 px) con celdas separadas por filetes:
 *  icono tintado + etiqueta, cifra 26/700, chip de variación (20) + sello de procedencia de UNA línea,
 *  y sparkline 60×24 o barra segmentada. Sin count-up: el valor real está en el primer render.
 *  Observado es silencioso (punto); Estimado / Inferido / Sin dato muestran su marca. */
export function TiraKpi({ items, etiqueta = 'Indicadores' }: { items: ItemKpi[]; etiqueta?: string }) {
  return (
    <section className="rv-kpis" aria-label={etiqueta}>
      {items.map((it) => {
        const vacio = it.valor === null || it.valor === undefined;
        const m = it.metrica ? metrica(it.metrica) : null;
        const matiz = m?.matiz ?? it.matiz;
        const tipo: TipoDato | undefined = vacio ? 'sin_dato' : (it.tipo ?? m?.clase);
        const texto = vacio ? '—' : typeof it.valor === 'number' ? numero(it.valor) : it.valor;
        const sello = it.sello ?? it.nota;
        const segs = it.segmentos?.filter((s) => s.valor !== null && s.valor > 0) ?? [];
        const cuerpo = (
          <>
            <span className="rv-kpi__cab">
              {it.icono ? <span className="rv-kpi__icono" aria-hidden="true">{it.icono}</span> : null}
              <span className="rv-kpi__etq">{it.etiqueta}</span>
            </span>
            <span className="rv-kpi__fila">
              <span className="rv-kpi__valor" data-vacio={vacio || undefined}>{texto}</span>
              {!vacio && it.serie && it.serie.length > 1 ? <span className="rv-kpi__spark"><Sparkline valores={it.serie} matiz={matiz} /></span> : null}
            </span>
            {!vacio && segs.length > 0 ? (
              <span className="rv-kpi__segs" role="img" aria-label={segs.map((s) => `${s.etiqueta} ${s.valor}`).join(', ')}>
                {segs.map((s, i) => <i key={s.etiqueta} style={{ flexGrow: s.valor! }} className={`rv-tono-${Math.min(i, 4)}`} />)}
              </span>
            ) : null}
            <span className="rv-kpi__pie">
              {it.delta && !vacio ? (
                <span className="rv-kpi__delta" data-tono={tonoDelta(it.delta)}>
                  <span aria-hidden="true">{FLECHA[it.delta.dir]}</span> {it.delta.texto}
                  <span className="rv-sr"> ({SENTIDO[it.delta.dir]})</span>
                </span>
              ) : null}
              {tipo === 'observado' ? <i className="rv-kpi__punto" aria-hidden="true" /> : tipo ? <KindBadge tipo={tipo} /> : null}
              {sello ? <span className="rv-kpi__sello">{sello}</span> : null}
            </span>
          </>
        );
        const comunes = { 'data-matiz': matiz, title: sello } as const;
        return it.href ? (
          <Link key={it.etiqueta} href={it.href} className="rv-kpi" {...comunes}>{cuerpo}</Link>
        ) : (
          <div key={it.etiqueta} className="rv-kpi" {...comunes}>{cuerpo}</div>
        );
      })}
    </section>
  );
}
