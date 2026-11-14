// ═══════════════════════════════════════════════════════════════════════════
// CONCURRENCIA ACOTADA para procesar un lote de bitácoras sin esperar una por una.
//
// Motivo (simulación del 14-nov-2026 contra la base local con 40 ms de latencia por consulta): una bitácora real hace ~12 consultas
// en serie y 70 bitácoras tardaban 39.7 s; con la latencia real de la nube pasaban de los 60 s de la función. Con unas cuantas
// bitácoras a la vez el tiempo baja casi en proporción y el tope de conexiones sigue acotado.
//
// Garantías (con prueba): el resultado sale en el MISMO orden que la entrada; nunca hay más de `limite` tareas en vuelo; la primera
// falla deja de repartir trabajo nuevo, espera a las que ya iban (para que ninguna promesa quede huérfana en serverless) y se
// relanza. Es seguro porque cada bitácora es idempotente por su clave: reintentar el lote completo no duplica nada.
// ═══════════════════════════════════════════════════════════════════════════

/** Bitácoras que se procesan a la vez en una petición del webhook de desgloses. */
export const CONCURRENCIA_DESGLOSES = 6;

export async function mapAcotado<T, R>(
  items: readonly T[], limite: number, tarea: (item: T, posicion: number) => Promise<R>,
): Promise<R[]> {
  const n = Math.max(1, Math.min(Math.trunc(limite) || 1, items.length || 1));
  const salida = new Array<R>(items.length);
  let siguiente = 0;
  let falla: { error: unknown } | null = null;
  const trabajador = async (): Promise<void> => {
    while (falla === null) {
      const i = siguiente++;
      if (i >= items.length) return;
      try {
        salida[i] = await tarea(items[i], i);
      } catch (error) {
        if (falla === null) falla = { error };
        return;
      }
    }
  };
  const trabajadores: Array<Promise<void>> = [];
  for (let k = 0; k < n; k++) trabajadores.push(trabajador());
  await Promise.all(trabajadores);
  if (falla !== null) throw (falla as { error: unknown }).error;
  return salida;
}

/**
 * Lectura compartida dentro de UNA petición: la configuración de envío no cambia dentro de un lote y leerla por cada bitácora costaba
 * una consulta de más. El mapa se crea por petición y se descarta con ella; guarda la promesa (las bitácoras concurrentes comparten la
 * misma lectura) y, si falla, no deja guardado el fallo: la siguiente bitácora reintenta.
 */
export type CachePeticion<R> = Map<string, Promise<R>>;

export function leerUnaVez<R>(cache: CachePeticion<R>, clave: string, leer: () => Promise<R>): Promise<R> {
  const previa = cache.get(clave);
  if (previa) return previa;
  const nueva = leer().catch((e) => { cache.delete(clave); throw e; });
  cache.set(clave, nueva);
  return nueva;
}
