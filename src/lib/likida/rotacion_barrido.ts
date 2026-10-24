// ═══════════════════════════════════════════════════════════════════════════
// ROTAR EL PUNTO DE ARRANQUE DE UN BARRIDO CON RELOJ (A37-S56-10).
//
// Los barridos horarios (`vigilarReglas`, `avisarVencimientos`) recorren las
// flotas en un orden FIJO (por UUID) y se cortan cuando se acaba el reloj del
// cron. Con carga alta, las flotas del final de la lista quedan fuera en CADA
// pasada y su vigilancia no corre jamás. Rotar el punto de partida por hora hace
// que el recorte sea equitativo: lo que esta hora quedó al final, la siguiente
// lo atiende primero. PURO y determinista (misma hora → mismo orden), así que no
// cambia qué se avisa cuando el barrido alcanza a terminar.
// ═══════════════════════════════════════════════════════════════════════════

const HORA_MS = 3_600_000;

/** Rota `items` para que arranque en la posición `hora % items.length`. */
export function rotarPorHora<T>(items: readonly T[], ahora: Date): T[] {
  if (items.length <= 1) return [...items];
  const desde = Math.floor(ahora.getTime() / HORA_MS) % items.length;
  return [...items.slice(desde), ...items.slice(0, desde)];
}

/**
 * Como `rotarPorHora`, pero respetando GRUPOS (flotas): la lista arranca en el
 * primer elemento del grupo `hora % nGrupos` (los grupos en orden de primera
 * aparición) y da la vuelta. Las reglas de una misma flota no se parten.
 */
export function rotarGruposPorHora<T>(items: readonly T[], grupoDe: (t: T) => string, ahora: Date): T[] {
  const grupos = [...new Set(items.map(grupoDe))];
  if (grupos.length <= 1) return [...items];
  const elegido = grupos[Math.floor(ahora.getTime() / HORA_MS) % grupos.length];
  const desde = items.findIndex((t) => grupoDe(t) === elegido);
  return [...items.slice(desde), ...items.slice(0, desde)];
}
