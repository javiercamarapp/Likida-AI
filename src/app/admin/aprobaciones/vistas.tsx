'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { SegmentedControl } from '../../ui-v2/componentes/segmented';
import '../bandeja.css';

export type VistaAprobaciones = 'aprobar' | 'enviar' | 'historial';

export interface OpcionVista<T extends string> { valor: T; etiqueta: string; conteo?: number | null }

/** Sub-vistas de UNA pantalla como PESTAÑAS SUBRAYADAS con contador (Rovaq «Acciones», «Datos y confianza»). La guarda
 *  `una_barra_de_pestanas` reserva `<Tabs>` a la barra automática del grupo, así que esto es un grupo de opciones (`SegmentedControl`,
 *  con flechas y foco en balancín) que `bandeja.css` pinta como pestañas: filete inferior, 32 px, la activa en 600 con subrayado.
 *  F26 ronda 3: la barra va ARRIBA de la tira de cifras (orden de Rovaq: pestañas con contador → filtros → tira → paneles), no debajo.
 *  Por eso son tres piezas que comparten el estado por contexto: `ProveedorVistas` envuelve el esqueleto, `BarraVistas` va en su
 *  ranura superior y `PanelesVistas` en el cuerpo. TODOS los paneles se renderizan (los inactivos con `hidden`): el servidor ya los
 *  leyó y cambiar de vista no recarga nada ni pierde lo escrito en un borrador. `conteo` null = sin dato (no se pinta); un 0 se pinta gris. */
const Contexto = createContext<{ vista: string; setVista: (v: string) => void } | null>(null);

export function ProveedorVistas({ inicial, children }: { inicial: string; children: ReactNode }) {
  const [vista, setVista] = useState<string>(inicial);
  return <Contexto.Provider value={{ vista, setVista }}>{children}</Contexto.Provider>;
}

export function BarraVistas<T extends string>({ etiqueta, opciones }: { etiqueta: string; opciones: readonly OpcionVista<T>[] }) {
  const c = useContext(Contexto);
  if (c === null) return null;
  return (
    <div className="bj-vistas bj-vistas--barra">
      <SegmentedControl etiqueta={etiqueta} opciones={opciones.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta, conteo: o.conteo ?? undefined }))} valor={c.vista as T} onChange={(v) => c.setVista(v)} />
    </div>
  );
}

export function PanelesVistas<T extends string>({ opciones, paneles }: { opciones: readonly OpcionVista<T>[]; paneles: Record<T, ReactNode> }) {
  const c = useContext(Contexto);
  if (c === null) return null;
  return (
    <div className="bj-vistas bj-vistas--paneles">
      {opciones.map((o) => <div key={o.valor} hidden={o.valor !== c.vista}>{paneles[o.valor]}</div>)}
    </div>
  );
}

/** Las dos mitades juntas, para quien no necesite separar la barra (conserva el contrato anterior). */
export function VistasConContador<T extends string>({ etiqueta, inicial, opciones, paneles }: {
  etiqueta: string;
  inicial: T;
  opciones: readonly OpcionVista<T>[];
  paneles: Record<T, ReactNode>;
}) {
  return (
    <ProveedorVistas inicial={inicial}>
      <BarraVistas etiqueta={etiqueta} opciones={opciones} />
      <PanelesVistas opciones={opciones} paneles={paneles} />
    </ProveedorVistas>
  );
}

const OPCIONES_APROBACIONES = (conteos: { aprobar: number | null; enviar: number | null }): readonly OpcionVista<VistaAprobaciones>[] => [
  { valor: 'aprobar', etiqueta: 'Por aprobar', conteo: conteos.aprobar },
  { valor: 'enviar', etiqueta: 'Por enviar', conteo: conteos.enviar },
  { valor: 'historial', etiqueta: 'Historial' },
];

/** Las tres sub-vistas de Aprobaciones (plan 2.1 #14): la barra con contadores, para la ranura superior del esqueleto. */
export function BarraVistasAprobaciones({ conteos }: { conteos: { aprobar: number | null; enviar: number | null } }) {
  return <BarraVistas<VistaAprobaciones> etiqueta="Vista de aprobaciones" opciones={OPCIONES_APROBACIONES(conteos)} />;
}

/** Los tres paneles de Aprobaciones, para el cuerpo del esqueleto (bajo la tira). */
export function PanelesAprobaciones({ conteos, porAprobar, porEnviar, historial }: {
  conteos: { aprobar: number | null; enviar: number | null };
  porAprobar: ReactNode;
  porEnviar: ReactNode;
  historial: ReactNode;
}) {
  return <PanelesVistas<VistaAprobaciones> opciones={OPCIONES_APROBACIONES(conteos)} paneles={{ aprobar: porAprobar, enviar: porEnviar, historial }} />;
}
