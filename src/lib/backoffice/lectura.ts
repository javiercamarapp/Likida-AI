// Contrato común de LECTURA HONESTA del Back-office. Las tablas `bo_*` se aplican a mano en producción (con autorización), así que el
// código debe tolerar su ausencia: una tabla que no existe NO es «cero» ni «todo en orden», es «No disponible. No es cero.».
//   ok            → se leyó (un arreglo vacío es «no hay nada», un dato real)
//   no_disponible → la tabla o columna aún no existe en esa base (42P01, PGRST205, 42703)
//   error         → la base respondió con un fallo: «no se pudo leer»
export type Lectura<T> =
  | { estado: 'ok'; dato: T }
  | { estado: 'no_disponible' }
  | { estado: 'error'; mensaje: string };

export const OK = <T>(dato: T): Lectura<T> => ({ estado: 'ok', dato });
export const NO_DISPONIBLE: Lectura<never> = { estado: 'no_disponible' };

/** PURA. ¿El error de Postgres/PostgREST dice «esa tabla o columna no existe»? */
export function esTablaAusente(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  const code = e.code ?? '';
  if (code === '42P01' || code === 'PGRST205' || code === '42703' || code === 'PGRST204') return true;
  return /does not exist|could not find the table|schema cache/i.test(e.message ?? '');
}

/** Ejecuta una lectura y la clasifica. Nunca lanza. */
export async function leerSeguro<T>(f: () => Promise<T>): Promise<Lectura<T>> {
  try {
    return OK(await f());
  } catch (e) {
    const err = e as { code?: string; message?: string } | null;
    if (esTablaAusente(err)) return NO_DISPONIBLE;
    return { estado: 'error', mensaje: err?.message ?? String(e) };
  }
}

/** Convierte la respuesta `{ data, error }` de supabase-js en `Lectura`. */
export function desdeRespuesta<T>(r: { data: T | null; error: { code?: string; message?: string } | null }): Lectura<T> {
  if (r.error) return esTablaAusente(r.error) ? NO_DISPONIBLE : { estado: 'error', mensaje: r.error.message ?? 'error' };
  return OK(r.data as T);
}
