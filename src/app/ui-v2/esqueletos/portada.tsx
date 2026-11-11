import type { ReactNode } from 'react';
import { MarcoPagina } from '../componentes';
import type { PropsCifra } from '../graficas';
import { BloqueAvisos, BloqueCifras, type PropsMarcoEsqueleto } from './comunes';

/** PORTADA (Rovaq «Hoy» `/overview` y «Resumen de plataforma» `/platform`). Orden fijo de arriba abajo:
 *   cabecera (eyebrow + h1 + apoyo + acciones) → titular de lectura → FILTROS (`<BarraPeriodo>`) → procedencia → avisos (≤2) →
 *   TIRA DE CIFRAS (4, con filete) → BLOQUES (`children`: `FilaTarjetas` 4-4-4, 6-6, 12…) → nota de método.
 *  La portada no inventa piezas: filtros, avisos y bloques los pone la página con el kit; el esqueleto fija el ORDEN y los márgenes (12 px).
 *  En la consola de plataforma, `formaCifras="tarjetas"` pinta las cifras como tarjetas sueltas (los `pf-tile`). */
export function EsqueletoPortada({ titular, filtros, procedencia, avisos, cifras, formaCifras = 'tira', etiquetaCifras, selloCifras, etiquetaProcedencia, children, metodo, ...marco }: PropsMarcoEsqueleto & {
  /** La frase que responde antes de la cifra (13/600, ≤655 px), con las cifras ya formateadas por quien llama. */
  titular?: string;
  /** `<BarraPeriodo …>` o `<BarraFiltros …>`: la barra de filtros de UNA fila. */
  filtros?: ReactNode;
  /** Barra de procedencia: fuentes al día, corte de datos. Items `<li>`. */
  procedencia?: ReactNode;
  /** Hasta dos `<Aviso>`. */
  avisos?: ReactNode;
  cifras?: readonly PropsCifra[];
  formaCifras?: 'tira' | 'tarjetas';
  etiquetaCifras?: string;
  selloCifras?: string;
  /** Nombre accesible de la barra de procedencia (texto del diccionario de la página; el esqueleto no trae texto propio). */
  etiquetaProcedencia?: string;
  /** Las filas de tarjetas, en su orden. */
  children?: ReactNode;
  /** Nota de método / parcialidad bajo el último bloque. */
  metodo?: ReactNode;
}) {
  return (
    <MarcoPagina className="rv-esq rv-esq--portada" {...marco}>
      {titular ? <p className="rv-esq__titular">{titular}</p> : null}
      {filtros}
      {procedencia ? <ul className="rv-esq__procedencia" aria-label={etiquetaProcedencia}>{procedencia}</ul> : null}
      <BloqueAvisos>{avisos}</BloqueAvisos>
      <BloqueCifras cifras={cifras} forma={formaCifras} etiqueta={etiquetaCifras} sello={selloCifras} />
      {children}
      {metodo ? <p className="rv-esq__metodo">{metodo}</p> : null}
    </MarcoPagina>
  );
}
