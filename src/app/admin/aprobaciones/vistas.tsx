'use client';

import { useState, type ReactNode } from 'react';
import { SegmentedControl } from '../../ui-v2/componentes/segmented';
import '../bandeja.css';

export type VistaAprobaciones = 'aprobar' | 'enviar' | 'historial';

export interface OpcionVista<T extends string> { valor: T; etiqueta: string; conteo?: number | null }

/** Sub-vistas de UNA pantalla como PESTAÑAS SUBRAYADAS con contador (Rovaq «Acciones», «Datos y confianza»). La guarda
 *  `una_barra_de_pestanas` reserva `<Tabs>` a la barra automática del grupo, así que esto es un grupo de opciones (`SegmentedControl`,
 *  con flechas y foco en balancín) que `bandeja.css` pinta como pestañas: filete inferior, 36 px, la activa en 600 con subrayado.
 *  TODOS los paneles se renderizan (los inactivos con `hidden`): el servidor ya los leyó y cambiar de vista no recarga nada ni pierde
 *  lo escrito en un borrador. `conteo` null = sin dato (no se pinta); un 0 se pinta gris. */
export function VistasConContador<T extends string>({ etiqueta, inicial, opciones, paneles }: {
  etiqueta: string;
  inicial: T;
  opciones: readonly OpcionVista<T>[];
  paneles: Record<T, ReactNode>;
}) {
  const [vista, setVista] = useState<T>(inicial);
  return (
    <div className="bj-vistas">
      <SegmentedControl etiqueta={etiqueta} opciones={opciones.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta, conteo: o.conteo ?? undefined }))} valor={vista} onChange={setVista} />
      {opciones.map((o) => <div key={o.valor} hidden={o.valor !== vista}>{paneles[o.valor]}</div>)}
    </div>
  );
}

/** Las tres sub-vistas de Aprobaciones (plan 2.1 #14). */
export function VistasAprobaciones({ inicial, conteos, porAprobar, porEnviar, historial }: {
  inicial: VistaAprobaciones;
  conteos: { aprobar: number | null; enviar: number | null };
  porAprobar: ReactNode;
  porEnviar: ReactNode;
  historial: ReactNode;
}) {
  return (
    <VistasConContador<VistaAprobaciones>
      etiqueta="Vista de aprobaciones" inicial={inicial}
      opciones={[
        { valor: 'aprobar', etiqueta: 'Por aprobar', conteo: conteos.aprobar },
        { valor: 'enviar', etiqueta: 'Por enviar', conteo: conteos.enviar },
        { valor: 'historial', etiqueta: 'Historial' },
      ]}
      paneles={{ aprobar: porAprobar, enviar: porEnviar, historial }}
    />
  );
}
