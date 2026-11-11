'use client';

import { useState, type ReactNode } from 'react';
import { SegmentedControl } from '../../ui-v2/componentes/segmented';
import '../bandeja.css';

export type VistaAprobaciones = 'aprobar' | 'enviar' | 'historial';

/** Las tres sub-vistas de Aprobaciones (plan 2.1 #14) como control segmentado en píldora con contador (Rovaq: vista en la barra de filtros). TODOS los paneles se
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
  const opciones = [
    { valor: 'aprobar' as const, etiqueta: 'Por aprobar', conteo: conteos.aprobar ?? undefined },
    { valor: 'enviar' as const, etiqueta: 'Por enviar', conteo: conteos.enviar ?? undefined },
    { valor: 'historial' as const, etiqueta: 'Historial' },
  ];
  const paneles: Record<VistaAprobaciones, ReactNode> = { aprobar: porAprobar, enviar: porEnviar, historial };
  return (
    <div className="bj-vistas">
      <SegmentedControl etiqueta="Vista de aprobaciones" opciones={opciones} valor={vista} onChange={setVista} />
      {opciones.map((o) => <div key={o.valor} hidden={o.valor !== vista}>{paneles[o.valor]}</div>)}
    </div>
  );
}
