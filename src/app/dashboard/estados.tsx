import type { ReactNode } from 'react';
import { BotonEnlace, EstadoError as EstadoErrorV2, EstadoVacio as EstadoVacioV2 } from '../ui-v2/componentes';

// Los estados ÚNICOS (ui-v2) con la firma que ya usaban las pantallas de /dashboard. Así las ~50 pantallas dejan de pintar su propia
// caja de «vacío» y de «error» sin tocar cada llamada: una sola implementación, dos nombres de siempre.
// Los componentes del kit de /admin (`admin/ui/kit.tsx`) siguen siendo los de v1 y no se tocan.

/** Vacío: título corto + la línea de siempre (children) + a lo sumo UNA acción. `icono` se acepta y se ignora (ya no hay ilustraciones). */
export function EstadoVacio({ titulo = 'Sin datos todavía', children, accion }: {
  titulo?: string;
  icono?: ReactNode;
  children: ReactNode;
  accion?: { href: string; texto: string };
}) {
  return (
    <EstadoVacioV2 titulo={titulo} accion={accion ? <BotonEnlace tamano="sm" href={accion.href}>{accion.texto}</BotonEnlace> : undefined}>
      {children}
    </EstadoVacioV2>
  );
}

/** Error blando: «No disponible ahora» + la causa que da la pantalla + Reintentar (vuelve a pedir los datos de la página). */
export function EstadoError({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  return <EstadoErrorV2 onReintentar={onReintentar} reintentar={!onReintentar}>{mensaje}</EstadoErrorV2>;
}
