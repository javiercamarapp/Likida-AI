import type { PasoTour } from './tipos';

/** El velo cubre el elemento con un bloqueo de clics SOLO en pasos informativos. Un paso que pide una acción
 *  («Aprieta aquí → …»), con o sin avance automático, deja el elemento libre: si no, el globo ordena apretar algo
 *  que no se puede apretar. */
export function bloqueaElClic(paso: Pick<PasoTour, 'accion' | 'avance'>): boolean {
  return !paso.accion && paso.avance?.tipo !== 'accion';
}
