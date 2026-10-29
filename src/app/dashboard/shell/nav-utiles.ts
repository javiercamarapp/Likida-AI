// Funciones puras de la navegación v2 (sin React): las comparten el menú, la tarjeta de cuenta y las pruebas.

/** Iniciales para el monograma de la tarjeta de cuenta. */
export function iniciales(nombre: string | null): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'F';
  const dos = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : partes[0].slice(0, 2);
  return dos.toUpperCase();
}

/** `/dashboard/agentes/peajes` → `agentes-peajes`; la raíz → `resumen`. */
export function anclaDe(href: string): string {
  return href.replace(/^\/dashboard\/?/, '').replace(/\//g, '-') || 'resumen';
}

/** «3/6» → {n:3, t:6}. Cualquier otra cosa → null (la insignia de puesta en marcha ya viene filtrada por el layout). */
export function avanceDe(insignia: string | undefined): { n: number; t: number } | null {
  const m = insignia ? /^(\d{1,2})\/(\d{1,2})$/.exec(insignia) : null;
  return m ? { n: Number(m[1]), t: Number(m[2]) } : null;
}


/**
 * Navegación por teclado de un menú (patrón APG): ArrowDown/ArrowUp recorren con vuelta, Home/End van a los extremos.
 * Devuelve el índice nuevo, o null si la tecla no es de navegación. `actual` = -1 si el foco no está en un ítem.
 */
export function indiceDeMenu(tecla: string, actual: number, total: number): number | null {
  if (total <= 0) return null;
  if (tecla === 'ArrowDown') return actual < 0 ? 0 : (actual + 1) % total;
  if (tecla === 'ArrowUp') return actual < 0 ? total - 1 : (actual - 1 + total) % total;
  if (tecla === 'Home') return 0;
  if (tecla === 'End') return total - 1;
  return null;
}
