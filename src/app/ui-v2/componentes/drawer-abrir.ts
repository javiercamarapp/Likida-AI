'use client';

import { useCallback, useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// APERTURA DE UN CAJÓN POR URL (`?abrir=<id>`). Un enlace profundo («Nuevo cliente» desde otra pantalla, un correo, un favorito) abre el
// cajón correcto; al cerrar se quita el parámetro con `history.replaceState` (sin recargar, sin entrada nueva en el historial, y Next
// sincroniza `useSearchParams` con ese cambio). No importa nada de `next/*`: el servidor puede decir `abiertoInicial` (leyó
// `searchParams.abrir`) para que el primer HTML ya nazca abierto, y el cliente lo confirma al montar y ante «atrás/adelante».
// ═══════════════════════════════════════════════════════════════════════════

export const PARAM_ABRIR = 'abrir';

/** ¿La URL actual pide abrir `id`? Fuera del navegador (SSR) siempre `false`. */
export function urlPideAbrir(id: string, param: string = PARAM_ABRIR): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(param) === id;
}

/** Quita `param` de la URL sin navegar. Conserva ruta, el resto del query y el hash. */
export function quitarParamAbrir(param: string = PARAM_ABRIR): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(param)) return;
  url.searchParams.delete(param);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function useAbrirPorUrl({ id, param = PARAM_ABRIR, abiertoInicial = false }: { id: string; param?: string; abiertoInicial?: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  // Al montar y en «atrás/adelante»: la URL manda. (No se cierra solo por no verla: abrir con el botón no toca la URL.)
  useEffect(() => {
    if (urlPideAbrir(id, param)) setAbierto(true);
    const alNavegar = () => { if (urlPideAbrir(id, param)) setAbierto(true); };
    window.addEventListener('popstate', alNavegar);
    return () => window.removeEventListener('popstate', alNavegar);
  }, [id, param]);
  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => { setAbierto(false); quitarParamAbrir(param); }, [param]);
  return { abierto, abrir, cerrar };
}
