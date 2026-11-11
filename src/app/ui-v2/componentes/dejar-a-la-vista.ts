/**
 * Deja a la vista el ítem activo del árbol del sidebar scrolleando SOLO el contenedor (`.rv-sb__nav`), sin `scrollIntoView`.
 * `scrollIntoView` mueve el punto de partida de la navegación secuencial del navegador al ítem: el primer Tab de una carga directa
 * se saltaba «Saltar al contenido» y caía en el menú. Esto mide y asigna `scrollTop`: el foco y su punto de partida no se tocan.
 */
export function dejarItemActivoALaVista(): void {
  if (typeof document === 'undefined') return;
  const item = document.querySelector<HTMLElement>('.rv-sb__nav [aria-current="page"]');
  const caja = item?.closest<HTMLElement>('.rv-sb__nav');
  if (!item || !caja) return;
  const a = item.getBoundingClientRect();
  const c = caja.getBoundingClientRect();
  if (a.top < c.top) caja.scrollTop -= c.top - a.top;
  else if (a.bottom > c.bottom) caja.scrollTop += a.bottom - c.bottom;
}
