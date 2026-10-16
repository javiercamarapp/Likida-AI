// ═══════════════════════════════════════════════════════════════════════════
// SELECTOR normal / nueva POR CONTENIDO (T-A3-44) — puro, sin E/S.
//
// Criterio PROVISIONAL (el cliente aún no lo confirma: pregunta 3 del análisis 17, B-2/B-10): si el documento trae MÁS DE UNA
// razón social de embarcador (orígenes `origen_nombre`, `origen_2_nombre`…) ⇒ plantilla «nueva»; con una sola ⇒ «normal».
// Dos orígenes con la MISMA razón social (mismo nombre, mayúsculas o espacios aparte) cuentan como una.
//
// Lo elegido a mano por una persona se respeta siempre. Es distinto de `elegirPlantilla` (salida_config.ts), que lee la
// configuración de la flota por perfil: este mira el CONTENIDO y lo dice con la bandera `criterio_provisional`.
// ═══════════════════════════════════════════════════════════════════════════

import type { Extraccion } from './campos';
import { llaveTexto } from './catalogos';

export type NombrePlantilla = 'normal' | 'nueva';

export const AVISO_SELECTOR_PROVISIONAL = 'Criterio provisional: más de una razón social de embarcador ⇒ plantilla «nueva». El cliente aún no lo confirma.';

export interface EleccionPorContenido {
  plantilla: NombrePlantilla;
  /** `contenido`: salió del criterio provisional; `manual`: la eligió una persona. */
  origen: 'contenido' | 'manual';
  /** Siempre `true` mientras el cliente no confirme el criterio, salvo elección manual. El visor lo muestra. */
  criterio_provisional: boolean;
  razones_sociales: string[];
  avisos: string[];
}

/** Razones sociales distintas de los orígenes (conserva la primera escritura de cada una). */
export function razonesSocialesEmbarcador(ext: Extraccion): string[] {
  const vistas = new Map<string, string>();
  for (const [k, v] of Object.entries(ext.campos)) {
    if (!/^origen(?:_\d{1,4})?_nombre$/.test(k)) continue;
    const t = (v?.valor ?? '').trim();
    if (t === '') continue;
    const llave = llaveTexto(t);
    if (!vistas.has(llave)) vistas.set(llave, t);
  }
  return [...vistas.values()];
}

export function elegirPlantillaPorContenido(ext: Extraccion, manual?: NombrePlantilla | null): EleccionPorContenido {
  const razones = razonesSocialesEmbarcador(ext);
  if (manual === 'normal' || manual === 'nueva') {
    return { plantilla: manual, origen: 'manual', criterio_provisional: false, razones_sociales: razones, avisos: [] };
  }
  const plantilla: NombrePlantilla = razones.length > 1 ? 'nueva' : 'normal';
  return { plantilla, origen: 'contenido', criterio_provisional: true, razones_sociales: razones, avisos: [AVISO_SELECTOR_PROVISIONAL] };
}
