// Traducción de excepciones de las ACCIONES del LOTE C (solo servidor: arrastra `administracion`). Aparte de utiles-c para que las
// funciones puras y sus pruebas no carguen el grafo de la capa de administración.
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { ErrorBo } from './utiles-c';

/** Traduce una excepción de una acción al texto de pantalla: las de validación con SU traductor, las demás por `mensajeParaPantalla`. */
export function textoDeError(
  e: unknown,
  t: (clave: never, vars?: Record<string, string | number>) => string,
  verbo: string,
): string {
  if (e instanceof ErrorBo) return (t as (c: string, v?: Record<string, string | number>) => string)(e.clave, e.vars);
  return mensajeParaPantalla(e, verbo);
}
