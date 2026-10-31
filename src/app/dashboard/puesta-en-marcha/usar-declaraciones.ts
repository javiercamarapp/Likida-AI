'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Declaraciones } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { claveProgreso, guardarDeclaraciones, leerDeclaraciones } from './progreso';

const EVENTO = 'likida-asistente-cambio';

function suscribir(fn: () => void): () => void {
  window.addEventListener('storage', fn);
  window.addEventListener(EVENTO, fn);
  return () => { window.removeEventListener('storage', fn); window.removeEventListener(EVENTO, fn); };
}

function almacen(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/**
 * Las declaraciones de la persona (lo que dice haber hecho y no se puede medir), leídas del navegador sin desajuste de
 * hidratación: en el servidor y en el primer render valen `{}`; después se sincronizan solas, también entre pestañas.
 * `soloLectura` (superadmin «viendo como») lee, pero `cambiar` no escribe.
 */
export function useDeclaraciones(ambito: string, soloLectura: boolean) {
  const crudo = useSyncExternalStore(
    suscribir,
    () => { try { return almacen()?.getItem(claveProgreso(ambito)) ?? ''; } catch { return ''; } },
    () => '',
  );
  const declaraciones = useMemo<Declaraciones>(() => {
    if (!crudo) return {};
    return leerDeclaraciones({ getItem: () => crudo, setItem: () => {}, removeItem: () => {} }, ambito);
  }, [crudo, ambito]);

  const cambiar = useCallback((siguiente: Declaraciones) => {
    if (soloLectura) return;
    guardarDeclaraciones(almacen(), ambito, siguiente);
    window.dispatchEvent(new Event(EVENTO));
  }, [ambito, soloLectura]);

  return { declaraciones, cambiar };
}
