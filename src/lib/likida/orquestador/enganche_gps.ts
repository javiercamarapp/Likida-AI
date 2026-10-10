// ═══════════════════════════════════════════════════════════════════════════
// ENGANCHE CON EL SEMÁFORO DE OBSOLESCENCIA DEL GPS.
//
// El mapa de la rama `loop/w3-gps-jornada` trae su propio semáforo
// (`gps_salud.ts`: en vivo ≤ 30 min, atrasada ≤ 6 h, obsoleta después). Aquí NO
// se duplica su lógica de pantalla: el orquestador solo necesita un NIVEL por
// posición, y lo pide por este único punto. `nivelDePosicionPorDefecto` usa los
// mismos umbrales y los mismos nombres para que, al integrar esa rama, el
// cambio sea de UNA línea (importar `nivelDePosicion` de `gps_salud` y
// reexportarlo aquí) sin tocar el tablero ni las herramientas.
// ═══════════════════════════════════════════════════════════════════════════

export type NivelFrescura = 'en_vivo' | 'atrasada' | 'obsoleta';

/** Hasta aquí, la posición es de «ahora» (el poll de GPS corre cada 5 min). */
export const MINUTOS_EN_VIVO = 30;
/** Hasta aquí, atrasada; más allá, obsoleta (6 h, el umbral que ya usaba el mapa). */
export const MINUTOS_ATRASADA = 360;

export function nivelDePosicionPorDefecto(minutos: number): NivelFrescura {
  if (!Number.isFinite(minutos) || minutos < 0) return 'obsoleta';
  if (minutos <= MINUTOS_EN_VIVO) return 'en_vivo';
  if (minutos <= MINUTOS_ATRASADA) return 'atrasada';
  return 'obsoleta';
}

export type ClasificadorFrescura = (minutos: number) => NivelFrescura;
