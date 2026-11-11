// ═══════════════════════════════════════════════════════════════════════════
// RECARGA ÚNICA ANTE UN CHUNK VIEJO (F16).
//
// Tras un despliegue, una pestaña abierta con el HTML anterior pide archivos JS cuyo nombre ya no existe: el navegador
// lanza `ChunkLoadError` ("Loading chunk 123 failed") o "Failed to fetch dynamically imported module" y el error
// boundary pintaba «No se pudo cargar», con un Reintentar que repite la misma petición vieja. Recargar la página trae
// el HTML nuevo y lo arregla. UNA vez por ventana: si tras recargar sigue fallando no es un chunk viejo (red caída,
// bloqueador), y un bucle de recargas es peor que el error.
//
// Módulo sin dependencias de React ni de Next: lo usan los `error.tsx` de admin y dashboard y `global-error`.
// ═══════════════════════════════════════════════════════════════════════════

export const CLAVE_RECARGA_CHUNK = 'likida:recarga-chunk';
/** No se recarga dos veces dentro de esta ventana. */
export const VENTANA_RECARGA_CHUNK_MS = 60_000;

const PATRON_CHUNK = /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** ¿Este error es un archivo de código que ya no existe en el servidor? */
export function esErrorDeChunk(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown };
  const nombre = typeof e.name === 'string' ? e.name : '';
  const mensaje = typeof e.message === 'string' ? e.message : '';
  return nombre === 'ChunkLoadError' || PATRON_CHUNK.test(mensaje);
}

export interface DepsRecarga {
  /** Mínimo de `Storage` que se usa. Puede lanzar (modo privado, cookies bloqueadas). */
  almacen?: Pick<Storage, 'getItem' | 'setItem'> | null;
  ahoraMs?: number;
  recargar?: () => void;
}

function almacenPorOmision(): DepsRecarga['almacen'] {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

/**
 * Si `error` es un chunk viejo y no se recargó ya en la última ventana, recarga la página y devuelve `true`.
 * Sin almacenamiento disponible NO recarga (no hay forma de impedir el bucle). NUNCA lanza.
 */
export function recargarSiChunkViejo(error: unknown, deps: DepsRecarga = {}): boolean {
  try {
    if (!esErrorDeChunk(error)) return false;
    const almacen = deps.almacen === undefined ? almacenPorOmision() : deps.almacen;
    if (!almacen) return false;
    const ahora = deps.ahoraMs ?? Date.now();
    const previo = Number(almacen.getItem(CLAVE_RECARGA_CHUNK));
    if (Number.isFinite(previo) && previo > 0 && ahora - previo < VENTANA_RECARGA_CHUNK_MS) return false;
    almacen.setItem(CLAVE_RECARGA_CHUNK, String(ahora));
    (deps.recargar ?? (() => window.location.reload()))();
    return true;
  } catch {
    return false;
  }
}
