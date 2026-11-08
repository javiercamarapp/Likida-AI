import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icono } from './icono';

/** Estado vacío ÚNICO: título (≤6 palabras, sin punto), UNA línea (qué falta y quién lo resuelve) y a lo sumo UNA acción. Sin
 *  ilustración, sin borde punteado y sin datos de ejemplo. La ausencia de datos nunca va en rojo (eso es `EstadoError`).
 *  Compacto dentro de una tarjeta; con `pantalla` ocupa el cuerpo de una pantalla vacía; con `contenido` NO se estira a la altura
 *  del vecino de la rejilla (alto máximo 220 px, centrado arriba) y puede llevar un icono de lucide de 20 px, sobrio y apagado.
 *  Distinto del `EstadoVacio` de admin/ui/kit.tsx, que sigue siendo el de v1. Sin componente de cliente: `icono` (un componente de
 *  lucide) solo debe pasarse desde otro componente de servidor o de cliente, nunca desde un servidor hacia un componente 'use client'. */
export function EstadoVacio({ titulo, children, accion, pantalla, contenido, icono }: {
  titulo: string;
  /** La línea: qué falta y quién lo resuelve (≤ 48 caracteres de ancho útil por renglón). */
  children?: ReactNode;
  /** UNA sola acción principal, y solo si el rol puede hacerla. */
  accion?: ReactNode;
  /** Pantalla entera vacía (con borde sólido y más aire), en vez de un hueco dentro de una tarjeta. */
  pantalla?: boolean;
  /** Variante contenida: alto natural con tope de 220 px y sin `flex: 1` (en una rejilla no crece con la tarjeta vecina). */
  contenido?: boolean;
  /** Icono lucide opcional sobre el título (20 px, trazo del sistema, color apagado). Decorativo. */
  icono?: LucideIcon;
  /** @deprecated sin efecto: ya no hay escenas. */
  escena?: string;
  /** @deprecated sin efecto: el estado vacío siempre es compacto salvo `pantalla`. */
  compacto?: boolean;
}) {
  return (
    <div className="rv-vacio" role="status" data-pantalla={pantalla || undefined} data-contenido={contenido || undefined}>
      {icono ? <span className="rv-vacio__icono" aria-hidden="true"><Icono icono={icono} tam={20} /></span> : null}
      <h3 className="rv-vacio__titulo">{titulo}</h3>
      {children ? <p className="rv-vacio__texto">{children}</p> : null}
      {accion ? <div className="rv-vacio__accion">{accion}</div> : null}
    </div>
  );
}
