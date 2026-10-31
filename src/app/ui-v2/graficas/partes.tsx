'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KindBadge, type TipoDato } from './kind-badge';
import type { Variacion } from './escala';

/** Ancho real (px) de un elemento; 0 hasta medirlo. Las gráficas se pintan a píxeles reales: el texto nunca se estira. */
export function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const leer = () => setAncho(Math.round(el.getBoundingClientRect().width));
    const marco = requestAnimationFrame(leer);
    const ro = new ResizeObserver(leer);
    ro.observe(el);
    return () => { cancelAnimationFrame(marco); ro.disconnect(); };
  }, []);
  return [ref, ancho] as const;
}

export const TEXTO_GUIA_TACTIL = 'Toca o desliza para ver el valor';
export const TEXTO_PARCIAL = 'parcial';
export const TEXTO_SIN_DATO = 's/d';

/** Lectura de un punto: la misma en el tooltip (escritorio) y en la cinta fija (móvil). Título, cifra, variación contra el periodo
 *  anterior (solo entre periodos completos), detalle y clase del dato. */
export function LecturaPunto({ titulo, parcial, cifra, variacion, contra, detalle, tipo }: {
  titulo: string;
  parcial?: boolean;
  cifra: string;
  variacion?: Variacion | null;
  contra?: string;
  detalle?: string;
  tipo?: TipoDato;
}) {
  return (
    <>
      <span className="rv-gt__cab"><span className="rv-gt__titulo">{titulo}</span>{parcial ? <span className="rv-gt__chip">{TEXTO_PARCIAL}</span> : null}</span>
      <strong className="rv-gt__cifra">{cifra}</strong>
      {variacion ? (
        <span className="rv-gt__delta" data-dir={variacion.dir}><i aria-hidden="true">{variacion.dir === 'up' ? '▲' : variacion.dir === 'down' ? '▼' : '–'}</i>{variacion.texto}{contra ? <small> contra {contra}</small> : null}</span>
      ) : parcial ? <span className="rv-gt__delta">Sin variación: periodo incompleto</span> : null}
      {detalle ? <small className="rv-gt__detalle">{detalle}</small> : null}
      {tipo && tipo !== 'observado' ? <span className="rv-gt__tipo"><KindBadge tipo={tipo} /></span> : null}
    </>
  );
}

/** Cinta fija sobre la gráfica en móvil (<820): sin globo; el dedo recorre las columnas y la lectura queda aquí. Oculta en escritorio. */
export function CintaLectura({ children }: { children: ReactNode | null }) {
  return <p className="rv-gr-cinta" role="status" data-vacia={children ? undefined : ''}>{children ?? TEXTO_GUIA_TACTIL}</p>;
}

/** Leyenda fina: trama = parcial; «s/d» = sin datos. Solo aparece si hay datos de ese tipo. Nunca una barra gris ni un cero. */
export function LeyendaFina({ parcial, sinDato }: { parcial?: boolean; sinDato?: boolean }) {
  if (!parcial && !sinDato) return null;
  return (
    <p className="rv-leyenda-fina">
      {parcial ? <span><i className="rv-leyenda-fina__trama" aria-hidden="true" />trama = parcial</span> : null}
      {sinDato ? <span><b aria-hidden="true">{TEXTO_SIN_DATO}</b>{' '}= sin datos</span> : null}
    </p>
  );
}

export interface FilaTabla { rotulo: string; celdas: readonly string[] }

/** «Ver como tabla»: la MISMA serie en una tabla accesible (región enfocable con nombre). Cierra la brecha de quien no puede leer el
 *  trazo; los valores son los de la gráfica, ya formateados, y un dato que falta sale «—», nunca 0. */
export function TablaGrafica({ titulo, encabezados, filas, primera = 'Periodo' }: {
  titulo: string;
  encabezados: readonly string[];
  filas: readonly FilaTabla[];
  primera?: string;
}) {
  return (
    <details className="rv-tabla-grafica">
      <summary>Ver como tabla</summary>
      <div className="rv-tabla-grafica__caja" role="region" tabIndex={0} aria-label={`Tabla de ${titulo}`}>
        <table>
          <thead><tr><th scope="col">{primera}</th>{encabezados.map((h) => <th key={h} scope="col" className="rv-num">{h}</th>)}</tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={`${f.rotulo}-${i}`}><th scope="row">{f.rotulo}</th>{f.celdas.map((c, j) => <td key={j} className="rv-num">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Lectura de varias series en un mismo periodo (columnas agrupadas): una fila por serie con su muestra de color (tono del matiz) y,
 *  si hay más de una, el total. El color nunca es la única señal: cada fila lleva el nombre. */
export function LecturaSeries({ titulo, filas, total }: {
  titulo: string;
  filas: ReadonlyArray<{ tono: number; nombre: string; texto: string }>;
  total?: string;
}) {
  return (
    <>
      <span className="rv-gt__cab"><span className="rv-gt__titulo">{titulo}</span></span>
      {filas.map((f) => (
        <span key={f.nombre} className="rv-gt__fila"><i className={`rv-gt__sw rv-tono-${f.tono}`} aria-hidden="true" /><span>{f.nombre}</span><strong>{f.texto}</strong></span>
      ))}
      {total ? <span className="rv-gt__fila rv-gt__total"><span>Total</span><strong>{total}</strong></span> : null}
    </>
  );
}
