'use client';

import { useEffect, useState } from 'react';

// Recuperación de ChunkLoadError para los error boundaries (como Rovaq). Después de un despliegue, una pestaña abierta pide un
// archivo de código que ya no existe: reintentar con `reset()` de React no vuelve a pedirlo, hace falta recargar el documento.
// La recarga automática ocurre UNA sola vez por pestaña (marca en sessionStorage) para no entrar en un bucle si el fallo persiste.

const MARCA = 'likida:chunk-recargado';
const PATRON_CHUNK = /ChunkLoadError|Loading chunk [^\s]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** ¿El error es de carga de código (no un fallo de datos)? Mira el nombre y el mensaje; el digest no dice nada de esto. */
export function esErrorDeChunk(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (typeof name === 'string' && PATRON_CHUNK.test(name)) || (typeof message === 'string' && PATRON_CHUNK.test(message));
}

/** Recarga una sola vez por pestaña. Devuelve true si ordenó la recarga. Sin almacenamiento (modo privado) no recarga sola. */
export function recargarSiChunk(error: unknown, entorno: { storage: Pick<Storage, 'getItem' | 'setItem'> | null; recargar: () => void }): boolean {
  if (!esErrorDeChunk(error) || !entorno.storage) return false;
  try {
    if (entorno.storage.getItem(MARCA)) return false;
    entorno.storage.setItem(MARCA, '1');
  } catch {
    return false;
  }
  entorno.recargar();
  return true;
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
