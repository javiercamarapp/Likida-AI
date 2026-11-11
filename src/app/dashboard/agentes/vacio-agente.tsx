import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { EstadoVacio } from '@/app/ui-v2/componentes';
import './agentes.css';

/** El vacío de una tarjeta de agente con el borde punteado de Rovaq (`ac-vacio`): una línea, sin altura de más. Envuelve al `EstadoVacio`
 *  del sistema (misma semántica y roles) y solo le pone el contorno. */
export function VacioAgente({ titulo, children, accion, icono }: { titulo: string; children?: ReactNode; accion?: ReactNode; icono?: LucideIcon }) {
  return (
    <div className="rv-ag-vacio">
      <EstadoVacio titulo={titulo} accion={accion} icono={icono} contenido>{children}</EstadoVacio>
    </div>
  );
}

/** Tabla sin filas con SU cabecera (Rovaq: la tabla vacía conserva los rótulos de columna) y el vacío punteado debajo. Mismas clases que `TablaBase`,
 *  así la cabecera de 36 px con texto en tinta es la misma que la de la tabla con datos. */
export function TablaVacia({ etiqueta, titulos, titulo, icono, children }: { etiqueta: string; titulos: readonly string[]; titulo: string; icono?: LucideIcon; children?: ReactNode }) {
  return (
    <div className="rv-ag-tabla-vacia">
      <div className="card rv-tb">
        <div className="rv-tb__region" role="region" aria-label={etiqueta}>
          <table data-densa="">
            <caption className="rv-sr">{etiqueta}</caption>
            <thead><tr>{titulos.map((t) => <th key={t} scope="col">{t}</th>)}</tr></thead>
          </table>
        </div>
      </div>
      <VacioAgente titulo={titulo} icono={icono}>{children}</VacioAgente>
    </div>
  );
}
