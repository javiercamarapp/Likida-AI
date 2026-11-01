import type { Recorrido, PasoTour } from '@/app/ui-v2/movimiento/tour/tipos';

// Utilidades puras del recorrido (sin menú ni permisos): las usa también el navegador.

/** Cuántos pasos cuenta la tarjeta: los saltos de menú («ir») no cuentan, el cierre sí. */
export const contarPasos = (pasos: readonly PasoTour[]): number => pasos.filter((p) => p.tipo !== 'ir').length;

/** Pantallas del recorrido, en orden, con el índice de su primer paso. */
export function pantallasDeRecorrido(r: Recorrido): Array<{ href: string; nombre: string; desde: number }> {
  const salida: Array<{ href: string; nombre: string; desde: number }> = [];
  r.pasos.forEach((p, i) => {
    if (p.pantalla && !salida.some((g) => g.href === p.pantalla)) salida.push({ href: p.pantalla, nombre: p.nombrePantalla ?? p.pantalla, desde: i });
  });
  return salida;
}
