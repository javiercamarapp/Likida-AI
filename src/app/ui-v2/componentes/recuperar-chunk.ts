'use client';

import { useEffect, useState } from 'react';

import { esErrorDeChunk, recargarSiChunkViejo } from '@/lib/recarga-chunk';

// Recuperación de ChunkLoadError para los error boundaries (como Rovaq). Después de un despliegue, una pestaña abierta pide un
// archivo de código que ya no existe: reintentar con `reset()` de React no vuelve a pedirlo, hace falta recargar el documento.
// La detección y la recarga única por ventana (F16) viven en `@/lib/recarga-chunk`: un solo mecanismo para todos los boundaries.

export { esErrorDeChunk };

/** Recarga a lo sumo una vez por ventana (F16). Devuelve true si ordenó la recarga. Sin almacenamiento (modo privado) no recarga sola. */
export function recargarSiChunk(error: unknown, entorno: { storage: Pick<Storage, 'getItem' | 'setItem'> | null; recargar: () => void }): boolean {
  return recargarSiChunkViejo(error, { almacen: entorno.storage, recargar: entorno.recargar });
}

export function useRecuperacionChunk(error: unknown, reset: () => void) {
  const chunk = esErrorDeChunk(error);
  const [recargando, setRecargando] = useState(false);
  useEffect(() => {
    if (!chunk) return;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { storage = null; }
    if (recargarSiChunk(error, { storage, recargar: () => window.location.reload() })) void Promise.resolve().then(() => setRecargando(true));
  }, [chunk, error]);
  // Con un fallo de chunk, «Reintentar» recarga el documento; con cualquier otro, vuelve a pintar el segmento.
  const reintentar = () => { if (chunk) window.location.reload(); else reset(); };
  return { chunk, recargando, reintentar };
}
