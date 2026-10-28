import Link from 'next/link';
import { Sparkline } from '@/app/admin/charts';
import { numero } from '@/lib/formato';
import { KindBadge, type TipoDato } from './kind-badge';

export interface ItemKpi {
  etiqueta: string;
  /** null = sin dato: se pinta «—» y nunca 0. Un número se formatea con lib/formato. */
  valor: string | number | null;
  nota?: string;
  /** Texto ya formateado, p. ej. «+4,2 %». El color va solo en el chip; la flecha lleva el sentido. */
  delta?: { texto: string; dir: 'sube' | 'baja' | 'igual'; bueno?: 'sube' | 'baja' } | null;
  serie?: number[];
  /** Matiz de datos 1..8 para el filete de 3 px. */
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

/** Tira de KPIs en UNA sola tarjeta con celdas separadas por filetes. Sin
 *  count-up al montar: el valor real está en el primer render (HTML servido). */
export function TiraKpi({ items, etiqueta = 'Indicadores' }: { items: ItemKpi[]; etiqueta?: string }) {
  return (
    <section className="rv-kpis" aria-label={etiqueta}>
      {items.map((it) => {
        const vacio = it.valor === null || it.valor === undefined;
        const texto = vacio ? '—' : typeof it.valor === 'number' ? numero(it.valor) : it.valor;
        const cuerpo = (
          <>
            <span className="rv-kpi__etq">{it.etiqueta}</span>
            <span className="rv-kpi__fila">
              <span className="rv-kpi__valor" data-vacio={vacio || undefined}>{texto}</span>
              {it.serie && it.serie.length > 1 ? <span className="rv-kpi__spark" aria-hidden="true"><Sparkline valores={it.serie} alto={24} /></span> : null}
            </span>
            <span className="rv-kpi__pie">
              {it.delta ? (
                <span className="rv-kpi__delta" data-tono={tonoDelta(it.delta)}>
                  <span aria-hidden="true">{FLECHA[it.delta.dir]}</span> {it.delta.texto}
                  <span className="rv-sr"> ({SENTIDO[it.delta.dir]})</span>
                </span>
              ) : null}
              {it.nota ? <span className="rv-kpi__nota">{it.nota}</span> : null}
              {it.tipo || vacio ? <KindBadge tipo={vacio ? 'sin_dato' : it.tipo!} /> : null}
            </span>
          </>
        );
        return it.href ? (
          <Link key={it.etiqueta} href={it.href} className="rv-kpi" data-matiz={it.matiz}>{cuerpo}</Link>
        ) : (
          <div key={it.etiqueta} className="rv-kpi" data-matiz={it.matiz}>{cuerpo}</div>
        );
      })}
    </section>
  );
}
