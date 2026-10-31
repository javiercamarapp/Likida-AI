import Link from 'next/link';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { numero } from '@/lib/formato';
import { resolverFormato, type FormatoPreset } from '../../admin/ui/formato-preset';
import { metrica, type MetricaId } from '../metricas';
import type { InfoClave } from '../info-catalogo';
import { InfoTip } from '../componentes/info-tip';
import { BotonReintentar } from '../componentes/boton-reintentar';
import { ConteoKpi } from './conteo-kpi';
import { KindBadge, type TipoDato } from './kind-badge';
import { Sparkline } from './sparkline';

export interface SegmentoKpi { etiqueta: string; valor: number | null }

/** Lo que se ve en el estado «error» de una cifra: nunca un cero, siempre la salida (Reintentar). */
export const MENSAJE_CIFRA_ERROR = 'No disponible ahora. No es cero.';

export interface PropsCifra {
  etiqueta: string;
  /** null = sin dato: se pinta «—» y nunca 0. Un número se formatea con lib/formato. */
  valor: string | number | null | undefined;
  /** Una línea de contexto bajo la cifra (12 px, apagada): qué cuenta o por qué importa. */
  nota?: string;
  /** Sello de procedencia en UNA línea («TMS · corte 31 oct 2026»). Sin elipsis; bajo 1100 px pasa al tooltip. */
  sello?: string;
  /** Estado de la cifra: ok (por omisión; sin valor = vacío), vacío (no hay dato: «—» + Sin dato) o error (falló la consulta:
   *  «No disponible ahora. No es cero.» + Reintentar). */
  estado?: 'ok' | 'vacio' | 'error';
  /** Vacío: qué falta. Error: causa (sustituye al texto por omisión). */
  mensaje?: string;
  /** Error desde un componente de servidor: Reintentar vuelve a pedir los datos de la página. */
  reintentar?: boolean;
  /** Atención sobre la cifra: el color va en el FILETE y en el chip de texto, nunca en el número. */
  tono?: 'ok' | 'warn' | 'bad';
  /** Formato de un `valor` numérico (preset del producto: mxn, entero, litros…). Por omisión, `numero` es-MX. */
  formato?: FormatoPreset;
  /** Variación en porcentaje contra el periodo anterior; `bueno` lo decide quien llama (gastar más no es buena noticia). */
  deltaPct?: { pct: number; bueno: boolean } | null;
  /** Complemento del texto de la variación (p. ej. «vs mes anterior»); por omisión, solo el porcentaje. */
  deltaNota?: string;
  /** Controles junto a la etiqueta (p. ej. los ‹ › de periodo). */
  flechas?: ReactNode;
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
  /** Clave del catálogo de explicaciones: pone la ⓘ en la esquina de la celda. */
  info?: InfoClave;
  /** Conteo corto de la cifra al montar (solo valores numéricos; sin pasar por 0; respeta reduced-motion). */
  conteo?: boolean;
}

/** @deprecated nombre anterior de `PropsCifra`. */
export type ItemKpi = PropsCifra & { /** @deprecated usa `sello`; se sigue mostrando como sello si no hay uno. */ nota?: string };

const FLECHA = { sube: '▲', baja: '▼', igual: '■' } as const;
const SENTIDO = { sube: 'sube', baja: 'baja', igual: 'sin cambio' } as const;
const ROTULO_TONO = { ok: 'Al día', warn: 'Atención', bad: 'Crítico' } as const;

function tonoDelta(d: NonNullable<PropsCifra['delta']>): 'ok' | 'bad' | 'neutral' {
  if (d.dir === 'igual' || !d.bueno) return 'neutral';
  return d.dir === d.bueno ? 'ok' : 'bad';
}

/** El indicador ÚNICO del producto (una sola implementación para Resumen, agentes, registros y detalle). Celda de una `TiraCifras`:
 *  filete de color de 3 px arriba (el de su métrica, o el del tono de atención), etiqueta, cifra 26/700 SIN color, chip de variación
 *  o de atención, nota y sello de procedencia de UNA línea, y sparkline 60×24 o barra segmentada. Sin count-up por omisión: el valor
 *  real está en el primer render. Observado es silencioso (punto); Estimado / Inferido / Sin dato muestran su marca. */
export function Cifra(p: PropsCifra) {
  const error = p.estado === 'error';
  const vacio = !error && (p.estado === 'vacio' || p.valor === null || p.valor === undefined || p.valor === '—');
  const m = p.metrica ? metrica(p.metrica) : null;
  const matiz = m?.matiz ?? p.matiz;
  const tipo: TipoDato | undefined = error ? 'sin_dato' : vacio ? 'sin_dato' : (p.tipo ?? m?.clase);
  const texto = vacio || error ? '—' : typeof p.valor === 'number' ? (p.formato ? resolverFormato(p.formato)(p.valor) : numero(p.valor)) : (p.valor as string);
  const delta = p.delta ?? (p.deltaPct ? {
    texto: p.deltaNota ? `${Math.abs(p.deltaPct.pct)} % ${p.deltaNota}` : `${Math.abs(p.deltaPct.pct)} %`,
    dir: p.deltaPct.pct > 0 ? 'sube' as const : p.deltaPct.pct < 0 ? 'baja' as const : 'igual' as const,
    bueno: (p.deltaPct.bueno ? (p.deltaPct.pct > 0 ? 'sube' : 'baja') : (p.deltaPct.pct > 0 ? 'baja' : 'sube')) as 'sube' | 'baja',
  } : null);
  const sello = p.sello;
  const segs = p.segmentos?.filter((s) => s.valor !== null && s.valor > 0) ?? [];
  const sinValor = vacio || error;
  const cuerpo = (
    <>
      <span className="rv-kpi__cab">
        {p.icono ? <span className="rv-kpi__icono" aria-hidden="true">{p.icono}</span> : null}
        {p.info && p.href ? <Link href={p.href} className="rv-kpi__etq rv-kpi__enlace">{p.etiqueta}</Link> : <span className="rv-kpi__etq">{p.etiqueta}</span>}
        {p.flechas ? <span className="rv-kpi__flechas">{p.flechas}</span> : null}
        {p.info ? <InfoTip clave={p.info} /> : null}
      </span>
      <span className="rv-kpi__fila">
        <span className="rv-kpi__valor" data-vacio={sinValor || undefined}>
          {p.conteo && typeof p.valor === 'number' && !sinValor ? <ConteoKpi valor={p.valor} /> : texto}
        </span>
        {!sinValor && p.serie && p.serie.length > 1 ? <span className="rv-kpi__spark"><Sparkline valores={p.serie} matiz={matiz} /></span> : null}
      </span>
      {error ? (
        <span className="rv-kpi__error" role="alert">
          <span>{p.mensaje ?? MENSAJE_CIFRA_ERROR}</span>
          {p.reintentar ? <BotonReintentar /> : null}
        </span>
      ) : null}
      {!sinValor && segs.length > 0 ? (
        <span className="rv-kpi__segs" role="img" aria-label={segs.map((s) => `${s.etiqueta} ${s.valor}`).join(', ')}>
          {segs.map((s, i) => <i key={s.etiqueta} style={{ flexGrow: s.valor! }} className={`rv-tono-${Math.min(i, 4)}`} />)}
        </span>
      ) : null}
      {vacio && (p.mensaje ?? p.nota) ? <span className="rv-kpi__nota">{p.mensaje ?? p.nota}</span> : null}
      {!sinValor && p.nota ? <span className="rv-kpi__nota">{p.nota}</span> : null}
      <span className="rv-kpi__pie">
        {delta && !sinValor ? (
          <span className="rv-kpi__delta" data-tono={tonoDelta(delta)}>
            <span aria-hidden="true">{FLECHA[delta.dir]}</span> {delta.texto}
            <span className="rv-sr"> ({SENTIDO[delta.dir]})</span>
          </span>
        ) : null}
        {p.tono && !sinValor ? <span className="rv-kpi__atencion" data-tono={p.tono}>{ROTULO_TONO[p.tono]}</span> : null}
        {p.deltaPct === null && !sinValor ? <span className="rv-kpi__sinbase">sin periodo comparable</span> : null}
        {tipo && tipo !== 'observado' ? <KindBadge tipo={tipo} /> : null}
        {tipo === 'observado' || sello ? (
          <span className="rv-kpi__sello">
            {tipo === 'observado' ? <i className="rv-kpi__punto" aria-hidden="true" /> : null}{sello}
          </span>
        ) : null}
      </span>
    </>
  );
  const cero = typeof p.valor === 'number' ? p.valor === 0 : typeof p.valor === 'string' && /\d/.test(p.valor) && Number(p.valor.replace(/[^0-9.]/g, '')) === 0;
  const comunes = { 'data-matiz': matiz, 'data-tono': p.tono, 'data-estado': error ? 'error' : vacio ? 'vacio' : undefined, title: sello, 'data-cero-fuente': !sinValor && cero && sello ? '' : undefined } as const;
  // Un botón ⓘ no puede ir DENTRO de un enlace: con `info`, el enlace pasa a la etiqueta y la celda es un div.
  return p.href && !p.info && !error ? (
    <Link href={p.href} className="rv-kpi" {...comunes}>{cuerpo}</Link>
  ) : (
    <div className="rv-kpi" {...comunes}>{cuerpo}</div>
  );
}

/** El mismo texto de sello en todo el producto: «Fuente · corte 31 oct 2026». */
export function selloDe(fuente: string, corte?: string | null): string {
  return corte ? `${fuente} · corte ${corte}` : fuente;
}

/** Matiz de datos (1..5) que una cifra SIN identidad de métrica toma por su lugar en la tira: así todo indicador lleva su filete de color.
 *  No es un ranking ni depende del dato: el lugar es fijo. Quien conozca la métrica pasa `metrica` y el color pasa a ser el de ella. */
const MATIZ_POR_LUGAR = [1, 2, 3, 5, 7] as const;

/** Tira de indicadores en UNA sola tarjeta (112 px): celdas separadas por filetes. Recibe `Cifra` como hijos o una lista `items`. */
export function TiraCifras({ items, children, etiqueta = 'Indicadores', sello, className }: {
  items?: PropsCifra[];
  children?: ReactNode;
  etiqueta?: string;
  /** Sello de procedencia por omisión de las celdas que no traen el suyo («Registro de viajes · corte 31 oct 2026»). */
  sello?: string;
  className?: string;
}) {
  let lugar = 0;
  const hijos = Children.map(children, (c) => {
    if (!isValidElement(c)) return c;
    const el = c as ReactElement<PropsCifra>;
    const i = lugar++;
    const extra: Partial<PropsCifra> = {};
    if (sello && el.props.sello === undefined) extra.sello = sello;
    if (el.props.metrica === undefined && el.props.matiz === undefined && el.props.tono === undefined) extra.matiz = MATIZ_POR_LUGAR[i % MATIZ_POR_LUGAR.length];
    return Object.keys(extra).length ? cloneElement(el, extra) : c;
  });
  return (
    <section className={className ? `rv-kpis ${className}` : 'rv-kpis'} aria-label={etiqueta}>
      {items ? items.map((it, i) => <Cifra key={it.etiqueta} {...it} sello={it.sello ?? sello} matiz={it.metrica === undefined && it.matiz === undefined && it.tono === undefined ? MATIZ_POR_LUGAR[i % MATIZ_POR_LUGAR.length] : it.matiz} />) : null}
      {hijos}
    </section>
  );
}
