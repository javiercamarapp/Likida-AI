import type { ReactNode } from 'react';
import { TiraCifras, type PropsCifra } from '../graficas';
import './esqueletos.css';

/** Lo que TODO esqueleto pasa al marco único (`MarcoPagina`): un solo h1, el área del menú, UNA línea de apoyo y las acciones a la
 *  derecha (a lo sumo una primaria). */
export interface PropsMarcoEsqueleto {
  /** Solo si la ruta no está en el menú del rol (detalles). Por omisión, el área del menú. */
  area?: string;
  /** El nombre EXACTO de la entrada del menú (o el de la entidad en una ficha). */
  titulo: string;
  idTitulo?: string;
  /** UNA línea de apoyo (≤140 caracteres). */
  apoyo?: string;
  acciones?: ReactNode;
}

/** Cifras de la página: una TIRA unida (`.hoy-kpis`/`.pc-kpis` de Rovaq) o TARJETAS sueltas con filete (`.ui-kpi`). Sin cifras no pinta nada
 *  (nunca una tira vacía): la página que no tiene dato dice «sin dato» en la celda, no omite la celda. */
export function BloqueCifras({ cifras, forma = 'tira', etiqueta, sello }: {
  cifras?: readonly PropsCifra[];
  forma?: 'tira' | 'tarjetas';
  etiqueta?: string;
  sello?: string;
}) {
  if (!cifras || cifras.length === 0) return null;
  if (forma === 'tarjetas') {
    return (
      <div className="rv-esq__cifras-sueltas" role="group" aria-label={etiqueta}>
        {cifras.map((c) => <TiraCifras key={c.etiqueta} items={[c]} etiqueta={c.etiqueta} sello={sello} entra="tarjeta" elevar />)}
      </div>
    );
  }
  return <TiraCifras items={[...cifras]} etiqueta={etiqueta} sello={sello} entra="seccion" />;
}

/** Máximo DOS avisos apilados bajo los filtros (Rovaq «Problemas»): lo demás va en la ⓘ o en un cajón. */
export function BloqueAvisos({ children }: { children?: ReactNode }) {
  return children ? <div className="rv-esq__avisos">{children}</div> : null;
}
