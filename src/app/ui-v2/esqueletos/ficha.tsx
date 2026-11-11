import type { ReactNode } from 'react';
import { BotonEnlace, FilaTarjetas, MarcoPagina, type VarianteFila } from '../componentes';
import type { PropsCifra } from '../graficas';
import { BloqueAvisos, BloqueCifras, type PropsMarcoEsqueleto } from './comunes';

/** FICHA DE ENTIDAD (Rovaq 06d «Ficha de problema», P2b «Ficha de cliente»). Orden:
 *   cabecera con eyebrow «FICHA DE …» (`area`), h1 = el nombre de la entidad y «Volver a …» a la derecha → TARJETA DE CHIPS (estado, clase
 *   de dato, grupo) con su línea de descripción → avisos → CIFRAS (4) → BLOQUES narrativos (`bloques`: dos columnas; causa · por qué
 *   importa · siguiente paso) → tabla o historial relacionado (`children`).
 *  Lo que no se pudo leer es una `Tarjeta` con `estado="error"` («No disponible ahora. No es cero», con Reintentar), nunca un cero. */
export function EsqueletoFicha({ volver, chips, descripcion, avisos, cifras, formaCifras = 'tira', etiquetaCifras, etiquetaResumen, etiquetaChips, bloques, variante = '6-6', children, acciones, ...marco }: Omit<PropsMarcoEsqueleto, 'acciones'> & {
  /** «Volver a problemas»: un enlace real a la lista de origen. */
  volver: { href: string; etiqueta: string };
  /** Chips de la entidad (`<Chip>`/`<StatusChip>`/`<SelloDato>`), como `<li>`. */
  chips?: ReactNode;
  descripcion?: string;
  avisos?: ReactNode;
  cifras?: readonly PropsCifra[];
  formaCifras?: 'tira' | 'tarjetas';
  etiquetaCifras?: string;
  /** Nombres accesibles de la tarjeta de resumen y de la lista de chips (texto del diccionario de la página; el esqueleto no trae texto propio). */
  etiquetaResumen?: string;
  etiquetaChips?: string;
  /** Tarjetas narrativas, en orden; cada una un `<Tarjeta titulo=…>`. */
  bloques?: readonly ReactNode[];
  variante?: VarianteFila;
  children?: ReactNode;
  /** Acciones propias de la ficha (a lo sumo una primaria); «Volver» se añade solo. */
  acciones?: ReactNode;
}) {
  const filas: ReactNode[][] = [];
  const porFila = variante === '4-4-4' ? 3 : variante === '12' ? 1 : 2;
  (bloques ?? []).forEach((b, i) => { (filas[Math.floor(i / porFila)] ??= []).push(b); });
  return (
    <MarcoPagina
      className="rv-esq rv-esq--ficha"
      {...marco}
      acciones={<>{acciones}<BotonEnlace href={volver.href} variante="secondary">{volver.etiqueta}</BotonEnlace></>}
    >
      {chips || descripcion ? (
        <section className="rv-tarjeta rv-esq__resumen" aria-label={etiquetaResumen}>
          <div className="rv-tarjeta__cuerpo">
            {chips ? <ul className="rv-esq__chips" aria-label={etiquetaChips}>{chips}</ul> : null}
            {descripcion ? <p className="rv-esq__ficha-desc">{descripcion}</p> : null}
          </div>
        </section>
      ) : null}
      <BloqueAvisos>{avisos}</BloqueAvisos>
      <BloqueCifras cifras={cifras} forma={formaCifras} etiqueta={etiquetaCifras} />
      {filas.map((fila, i) => <FilaTarjetas key={i} variante={fila.length === 1 ? '12' : variante}>{fila}</FilaTarjetas>)}
      {children}
    </MarcoPagina>
  );
}
