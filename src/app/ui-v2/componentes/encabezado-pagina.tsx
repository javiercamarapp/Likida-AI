import type { ReactNode } from 'react';
import { EtiquetaArea } from './contexto-area';

/** Techo de la línea de apoyo (ANEXO A.R05 punto 3): UNA oración. Lo demás va en un Aviso o en la ⓘ. */
export const APOYO_MAX = 140;

/** El ÚNICO encabezado de pantalla: etiqueta del área (la del menú) sobre el título (el nombre del menú, 20/600), UNA línea de
 *  apoyo de ≤140 caracteres y las acciones a la derecha (máximo una primaria y dos secundarias). Sin miga de pan: la barra superior
 *  ya no repite el título. Sin [data-ui="v2"] se ve como un título sobrio de siempre (misma jerarquía, sin la piel nueva). */
export function EncabezadoPagina({ area, titulo, idTitulo, apoyo, acciones }: {
  /** Solo si la ruta no está en el menú del rol (detalles, pantallas ocultas). Por omisión: el área del menú. */
  area?: string;
  /** El nombre EXACTO de la entrada del menú. */
  titulo: string;
  /** `id` del h1, para que la región de la pantalla se nombre con él (`aria-labelledby`). */
  idTitulo?: string;
  /** Qué se ve y de dónde sale, en una línea (≤140 caracteres; saludo en Inicio y Dirección). */
  apoyo?: string;
  acciones?: ReactNode;
}) {
  return (
    <header className="rv-encabezado" data-onboarding="pantalla.titulo">
      <div className="rv-encabezado__texto">
        <EtiquetaArea area={area} />
        <h1 id={idTitulo} className="rv-encabezado__titulo font-display">{titulo}</h1>
        {apoyo ? <p className="rv-encabezado__desc">{apoyo}</p> : null}
      </div>
      {acciones ? <div className="rv-encabezado__acciones">{acciones}</div> : null}
    </header>
  );
}
