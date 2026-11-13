import { useId, type ReactNode } from 'react';
import { FilaTarjetas, MarcoPagina, type VarianteFila } from '../componentes';
import type { PropsCifra } from '../graficas';
import { BloqueAvisos, BloqueCifras, type PropsMarcoEsqueleto } from './comunes';

export interface CajaSaber { titulo: string; items: readonly string[] }
/** Las dos cajas bajo las gráficas; el título viene de la página (diccionario i18n): el esqueleto no trae texto propio. */
export interface Saberes {
  /** Lo que sí se sabe (caja blanca, borde sólido). */
  seSabe: CajaSaber;
  /** Lo que NO se sabe (caja gris, borde punteado): lo desconocido se dibuja, no se omite ni se rellena con ceros. */
  noSeSabe: CajaSaber;
}

/** PANEL DE CIFRAS (Rovaq «CFO» `/cfo`, «Brechas», «Fuga», «Cortes publicados»; también el mapa de problemas con `variante="8-4"`).
 *  Orden: cabecera → titular de lectura → FILTROS → avisos (≤2) → CIFRAS (tira o 4 tarjetas con filete) → REJILLA de gráficas 2 col
 *  (`graficas`: una `Tarjeta` por gráfica, con su leyenda y su nota de método) → bloques de apoyo (`children`: tablas) →
 *  «Qué se sabe / Qué no se sabe» → nota de método. Las gráficas son las de `ui-v2/graficas` (monocromo, solo datos reales).
 *  `variante` es la forma de la rejilla (`6-6` por omisión; `8-4` para una principal + un panel; `12` para una sola). */
export function EsqueletoPanelCifras({ titular, filtros, avisos, cifras, formaCifras = 'tira', etiquetaCifras, selloCifras, graficas, variante = '6-6', children, saberes, metodo, ...marco }: PropsMarcoEsqueleto & {
  titular?: string;
  filtros?: ReactNode;
  avisos?: ReactNode;
  cifras?: readonly PropsCifra[];
  formaCifras?: 'tira' | 'tarjetas';
  etiquetaCifras?: string;
  selloCifras?: string;
  /** Las tarjetas de gráfica, en orden (1 a 4). Cada una es un `<Tarjeta titulo=…>` ya armado, con su `estado`. */
  graficas?: readonly ReactNode[];
  variante?: VarianteFila;
  /** Tablas y bloques de apoyo bajo la rejilla. */
  children?: ReactNode;
  saberes?: Saberes;
  metodo?: ReactNode;
}) {
  const id = useId();
  const filas: ReactNode[][] = [];
  const porFila = variante === '4-4-4' ? 3 : variante === '12' ? 1 : 2;
  (graficas ?? []).forEach((g, i) => { (filas[Math.floor(i / porFila)] ??= []).push(g); });
  return (
    <MarcoPagina className="rv-esq rv-esq--panel" {...marco}>
      {titular ? <p className="rv-esq__titular">{titular}</p> : null}
      {filtros}
      <BloqueAvisos>{avisos}</BloqueAvisos>
      <BloqueCifras cifras={cifras} forma={formaCifras} etiqueta={etiquetaCifras} sello={selloCifras} />
      {filas.map((fila, i) => <FilaTarjetas key={i} variante={fila.length === 1 ? '12' : fila.length === 2 && variante === '4-4-4' ? '6-6' : variante}>{fila}</FilaTarjetas>)}
      {children}
      {saberes ? (
        <div className="rv-esq__saberes">
          <section className="rv-esq__saber" aria-labelledby={`${id}-si`}>
            <h3 id={`${id}-si`}>{saberes.seSabe.titulo}</h3>
            <ul>{saberes.seSabe.items.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
          <section className="rv-esq__saber" data-no-sabe="" aria-labelledby={`${id}-no`}>
            <h3 id={`${id}-no`}>{saberes.noSeSabe.titulo}</h3>
            <ul>{saberes.noSeSabe.items.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        </div>
      ) : null}
      {metodo ? <p className="rv-esq__metodo">{metodo}</p> : null}
    </MarcoPagina>
  );
}

