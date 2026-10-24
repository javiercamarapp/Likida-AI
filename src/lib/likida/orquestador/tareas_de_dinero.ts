import { fuentes } from './fuentes';
import type { TareaAbierta } from './escalamiento';
import { rolPuedeLeerTarea, tareaEsDeDinero } from './permisos';

/** Cuántas tareas de dinero se pintan en el panel del contador. */
export const TOPE_TAREAS_DINERO = 20;

/**
 * Las tareas de dinero abiertas que el asistente derivó (A37-S17-03). El filtro de dinero va EN LA CONSULTA (antes del límite): con
 * muchas escalaciones operativas abiertas, una tarea de dinero vieja ya no queda fuera de la ventana. Se pide UNA de más para saber
 * si hay más de las que se pintan. Un fallo de lectura es `error` (distinto de «no hay tareas»), y `sin_tabla` es una base sin la 0650.
 */
export type LecturaTareasDinero =
  | { estado: 'ok'; tareas: TareaAbierta[]; hayMas: boolean }
  | { estado: 'sin_tabla' }
  | { estado: 'error' };

export async function leerTareasDeDinero(tenantId: string, rol: string | undefined): Promise<LecturaTareasDinero> {
  try {
    const l = await fuentes().escalacionesAbiertas(tenantId, TOPE_TAREAS_DINERO + 1, { soloDinero: true });
    if (l === null) return { estado: 'sin_tabla' };
    const legibles = l.filter((t) => tareaEsDeDinero(t) && rolPuedeLeerTarea(rol, t));
    return { estado: 'ok', tareas: legibles.slice(0, TOPE_TAREAS_DINERO), hayMas: legibles.length > TOPE_TAREAS_DINERO };
  } catch {
    return { estado: 'error' };
  }
}
