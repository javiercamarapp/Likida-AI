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
