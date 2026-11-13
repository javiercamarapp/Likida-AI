import type { ReactNode } from 'react';
import { MarcoPagina } from '../componentes';
import type { PropsCifra } from '../graficas';
import { BloqueAvisos, BloqueCifras, type PropsMarcoEsqueleto } from './comunes';

/** TABLA MAESTRA con cajón de vista rápida (Rovaq «Problemas» `/problems`, «Importaciones», «Auditoría», «Acciones»). Orden:
 *   cabecera → (pestañas subrayadas del grupo: las pinta el marco) → FILTROS (`<BarraPeriodo>`) → avisos (≤2) → CIFRAS (tira) →
 *   AGRUPACIÓN opcional (lista de barras que filtra la tabla) → TABLA (`children`: `TablaLista`, cabecera 36 y fila 40, orden por URL,
 *   «Vista rápida» ghost en la última columna) → pie → CAJÓN (`vistaRapida`: `<CajonVistaRapida>`, solo cuando la URL trae `ver`).
 *  La tabla ES una `TablaLista` (o `TablaBase` si es corta): este esqueleto no dibuja filas. Con `vistaRapida` omitido es una lista
 *  sin cajón (bandeja de avisos, historiales). */
export function EsqueletoTablaMaestra({ filtros, avisos, cifras, formaCifras = 'tira', etiquetaCifras, selloCifras, agrupacion, children, pie, vistaRapida, ...marco }: PropsMarcoEsqueleto & {
  filtros?: ReactNode;
  avisos?: ReactNode;
  cifras?: readonly PropsCifra[];
  formaCifras?: 'tira' | 'tarjetas';
  etiquetaCifras?: string;
  selloCifras?: string;
  /** Una `Tarjeta` con la agrupación clicable («Conversaciones por categoría»). */
  agrupacion?: ReactNode;
  /** La tabla (o el vacío punteado si no hay filas). */
  children?: ReactNode;
  /** El pie declarado: «25 de 394». */
  pie?: ReactNode;
  /** El cajón de la fila elegida; null cuando la URL no pide ninguna. */
  vistaRapida?: ReactNode;
}) {
  return (
    <MarcoPagina className="rv-esq rv-esq--tabla" {...marco}>
      {filtros}
      <BloqueAvisos>{avisos}</BloqueAvisos>
      <BloqueCifras cifras={cifras} forma={formaCifras} etiqueta={etiquetaCifras} sello={selloCifras} />
      {agrupacion}
      <div className="rv-esq__tabla">
        {children}
        {pie ? <p className="rv-esq__tabla-pie">{pie}</p> : null}
      </div>
      {vistaRapida}
    </MarcoPagina>
  );
}
