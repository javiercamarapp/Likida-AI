'use client';

import { useState, type ReactNode } from 'react';
import { SegmentedControl } from '../../ui-v2/componentes/segmented';
import '../bandeja.css';

export type VistaAprobaciones = 'aprobar' | 'enviar' | 'historial';

/** Las tres sub-vistas de Aprobaciones (plan 2.1 #14). TODOS los paneles se renderizan (los inactivos con `hidden`): el servidor ya
 *  los leyó y cambiar de vista no recarga nada ni pierde lo escrito en un borrador. `conteo` null = sin dato (no se pinta). */
export function VistasAprobaciones({ inicial, conteos, porAprobar, porEnviar, historial }: {
  inicial: VistaAprobaciones;
  conteos: { aprobar: number | null; enviar: number | null };
  porAprobar: ReactNode;
  porEnviar: ReactNode;
  historial: ReactNode;
}) {
  const [vista, setVista] = useState<VistaAprobaciones>(inicial);
  return (
    <div className="bj-vistas">
      <div>
        <SegmentedControl<VistaAprobaciones>
          etiqueta="Vista de aprobaciones" valor={vista} onChange={setVista}
          opciones={[
            { valor: 'aprobar', etiqueta: 'Por aprobar', ...(conteos.aprobar !== null ? { conteo: conteos.aprobar } : {}) },
            { valor: 'enviar', etiqueta: 'Por enviar', ...(conteos.enviar !== null ? { conteo: conteos.enviar } : {}) },
            { valor: 'historial', etiqueta: 'Historial' },
          ]}
        />
      </div>
      <div className="bj-panel" hidden={vista !== 'aprobar'}>{porAprobar}</div>
      <div className="bj-panel" hidden={vista !== 'enviar'}>{porEnviar}</div>
      <div className="bj-panel" hidden={vista !== 'historial'}>{historial}</div>
    </div>
  );
}
