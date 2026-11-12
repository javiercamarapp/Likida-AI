// LA bandeja de avisos de una persona: la ÚNICA función que el pie (campana) y la pantalla de avisos llaman. Del mismo resultado salen el
// número del pie y la pestaña «No leídas»: no existe una segunda cuenta. Se inyectan las lecturas para probarla sin red.
import type { SupabaseClient } from '@supabase/supabase-js';
import { leerLeidas, leerPreferencias, type Resultado } from './estado';
import {
  aplicarPreferencias, categoriasApagadasEnApp, contarNoLeidos, hayCriticoNoLeido,
  type Ambito, type Aviso, type Categoria, type Preferencia,
} from './modelo';

export interface FuenteAvisos {
  /** Todos los avisos generados (antes de preferencias). */
  avisos: Aviso[];
  /** ISO del momento en que se midió (la fuente puede venir de una caché corta). */
  generadoEn: string;
}

export interface Bandeja {
  /** Lo que entra a la lista y a la cuenta (ya con las preferencias de «en la app» aplicadas). */
  avisos: Aviso[];
  leidas: Set<string>;
  prefs: Preferencia[];
  apagadas: Set<Categoria>;
  /** EL número del pie. `null` = no se pudo leer qué se ha leído: «sin dato», nunca 0. */
  noLeidos: number | null;
  hayCritico: boolean;
  generadoEn: string;
  /** Lo que no se pudo leer, para decirlo en pantalla. */
  errorLeidas: string | null;
  errorPrefs: string | null;
}

export interface LectoresBandeja {
  leidas: (db: SupabaseClient, a: Ambito, userId: string) => Promise<Resultado<{ leidas: Set<string> }>>;
  prefs: (db: SupabaseClient, a: Ambito, userId: string) => Promise<Resultado<{ prefs: Preferencia[] }>>;
}

export async function resolverBandeja(
  db: SupabaseClient, ambito: Ambito, userId: string, fuente: FuenteAvisos,
  lectores: LectoresBandeja = { leidas: leerLeidas, prefs: leerPreferencias },
): Promise<Bandeja> {
  const [l, p] = await Promise.all([lectores.leidas(db, ambito, userId), lectores.prefs(db, ambito, userId)]);
  // Preferencias ilegibles: se avisa y se muestra todo (el valor por omisión es avisar; ocultar por una lectura caída sería callar).
  const prefs = p.ok ? p.prefs : [];
  const apagadas = categoriasApagadasEnApp(prefs);
  const avisos = aplicarPreferencias(fuente.avisos, apagadas);
  const leidas = l.ok ? l.leidas : new Set<string>();
  return {
    avisos, leidas, prefs, apagadas,
    noLeidos: l.ok ? contarNoLeidos(avisos, leidas) : null,
    hayCritico: hayCriticoNoLeido(avisos, leidas),
    generadoEn: fuente.generadoEn,
    errorLeidas: l.ok ? null : l.error,
    errorPrefs: p.ok ? null : p.error,
  };
}
