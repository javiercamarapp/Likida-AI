'use client';

import { useState, type ReactNode } from 'react';
import { Tabs } from '../../ui-v2/componentes/tabs';
import '../bandeja.css';

export type VistaAprobaciones = 'aprobar' | 'enviar' | 'historial';

/** Las tres sub-vistas de Aprobaciones (plan 2.1 #14) como PESTAÑAS SUBRAYADAS con contador (Rovaq «Acciones»). TODOS los paneles se
 *  renderizan (los inactivos con `hidden`, lo hace `Tabs`): el servidor ya los leyó y cambiar de vista no recarga nada ni pierde lo
 *  escrito en un borrador. `conteo` null = sin dato (no se pinta). Lo que espera una decisión lleva el contador en burdeos. */
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
      <Tabs
        etiqueta="Vista de aprobaciones" valor={vista} onChange={(v) => setVista(v as VistaAprobaciones)}
        pestanas={[
          { valor: 'aprobar', etiqueta: 'Por aprobar', conteo: conteos.aprobar, atencion: true, contenido: porAprobar },
          { valor: 'enviar', etiqueta: 'Por enviar', conteo: conteos.enviar, atencion: true, contenido: porEnviar },
          { valor: 'historial', etiqueta: 'Historial', contenido: historial },
        ]}
      />
    </div>
  );
}
