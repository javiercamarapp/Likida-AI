import { Inbox } from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';
import { BotonEnlace, EstadoError as EstadoErrorV2, EstadoVacio as EstadoVacioV2 } from '../ui-v2/componentes';

// Los estados ÚNICOS (ui-v2) con la firma que ya usaban las pantallas de /dashboard. Así las ~50 pantallas dejan de pintar su propia
// caja de «vacío» y de «error» sin tocar cada llamada: una sola implementación, dos nombres de siempre.
// Los componentes del kit de /admin (`admin/ui/kit.tsx`) siguen siendo los de v1 y no se tocan.

/** Largo del texto plano de un ReactNode (cadenas, arreglos y los hijos de los elementos). */
export function largoTexto(n: ReactNode): number {
  if (typeof n === 'string') return n.length;
  if (typeof n === 'number') return String(n).length;
  if (Array.isArray(n)) return n.reduce((a: number, x) => a + largoTexto(x as ReactNode), 0);
  if (isValidElement<{ children?: ReactNode }>(n)) return largoTexto(n.props.children);
  return 0;
}

/** Más allá de esto la explicación va detrás de «Ver más»: un estado vacío es una línea, no un párrafo centrado. */
export const LARGO_MAX_VACIO = 150;

/** Vacío CONTENIDO: icono sobrio, título corto, la línea de siempre (children) y a lo sumo UNA acción. No se estira a la altura de
 *  su vecino de rejilla. Si la explicación es larga, queda plegada en «Ver más» en vez de un muro de texto centrado.
 *  `icono` (ReactNode heredado) se acepta y se ignora: el icono es el mismo en todo el producto. */
export function EstadoVacio({ titulo = 'Sin datos todavía', children, accion }: {
  titulo?: string;
  icono?: ReactNode;
  children: ReactNode;
  accion?: { href: string; texto: string };
}) {
  const largo = largoTexto(children) > LARGO_MAX_VACIO;
  return (
    <EstadoVacioV2 contenido icono={Inbox} titulo={titulo} accion={accion ? <BotonEnlace tamano="sm" href={accion.href}>{accion.texto}</BotonEnlace> : undefined}>
      {largo ? <details className="rv-vacio__mas"><summary>Ver más</summary><span>{children}</span></details> : children}
    </EstadoVacioV2>
  );
}

/** Error blando: «No disponible ahora» + la causa que da la pantalla + Reintentar (vuelve a pedir los datos de la página). */
export function EstadoError({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  return <EstadoErrorV2 onReintentar={onReintentar} reintentar={!onReintentar}>{mensaje}</EstadoErrorV2>;
}
