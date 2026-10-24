// A37-S31-01 · Leer hasta un TOPE de filas sin que PostgREST lo recorte en silencio.
//
// `.limit(5000)` no sirve: el proyecto corta cada respuesta a `max_rows` (1,000 en supabase/config.toml), así que 5,000
// jamás se alcanzaba, el aviso de «catálogo truncado» (`filas >= tope`) nunca se disparaba y las filas 1,001+ salían como
// «sin coincidencia». Aquí se pagina con `range()`, se pide el total exacto en la primera página y el cursor avanza por filas
// REALMENTE leídas. `truncado` es verdad solo si el total de la base pasa del tope.

export const PAGINA_LECTURA = 1000;

export type RespuestaPagina<T> = { data: T[] | null; error: { message: string; code?: string } | null; count?: number | null };

export interface LecturaConTope<T> {
  data: T[] | null;
  error: { message: string; code?: string } | null;
  /** Hay más filas en la base que las que el tope deja leer. */
  truncado: boolean;
}

/**
 * `pedir(desde, hasta, primera)` ejecuta la consulta ya ordenada con `.range(desde, hasta)`; en la primera página debe pedir
 * el conteo exacto (`{ count: 'exact' }` en el `.select`).
 */
export async function leerConTope<T>(
  pedir: (desde: number, hasta: number, primera: boolean) => PromiseLike<RespuestaPagina<T>>,
  tope: number,
): Promise<LecturaConTope<T>> {
  const filas: T[] = [];
  let total: number | null = null;
  for (let desde = 0; filas.length < tope; ) {
    const hasta = Math.min(desde + PAGINA_LECTURA, tope) - 1;
    const r = await pedir(desde, hasta, desde === 0);
    if (r.error) return { data: null, error: r.error, truncado: false };
    if (desde === 0 && typeof r.count === 'number') total = r.count;
    const pag = r.data ?? [];
    if (pag.length === 0) break;
    filas.push(...pag);
    desde += pag.length;
    if (total !== null && filas.length >= total) break;
    // Sin conteo no se puede dar la lectura por completa con una página corta (max_rows puede ser menor): se sigue hasta una vacía.
  }
  const truncado = total !== null ? total > tope : filas.length >= tope;
  return { data: filas.slice(0, tope), error: null, truncado };
}
