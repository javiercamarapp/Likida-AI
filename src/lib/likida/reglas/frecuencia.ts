// ═══════════════════════════════════════════════════════════════════════════
// EL LÍMITE DE FRECUENCIA DE UNA REGLA (0520) — puro, sin I/O.
//
// El barrido corre cada hora. Sin techo, una regla con casos nuevos a cada
// vuelta mandaría 24 avisos al día y el jefe aprendería a ignorar el canal.
// Cada regla trae DOS límites y los dos se evalúan contra el historial de
// avisos que SÍ salieron (`regla_aviso`, resultado 'enviado'):
//
//   · `maxAvisosDia`        — a lo más N avisos en una ventana móvil de 24 h.
//   · `minHorasEntreAvisos` — separación mínima desde el último aviso.
//
// Lo que NO hace el límite: perder casos. Un diferido no se sella, así que el
// caso sigue siendo «nuevo» y sale agrupado en el siguiente aviso permitido.
// Un aviso FALLIDO no cuenta: el tope mide mensajes entregados al canal, no
// intentos, para que un Meta caído no agote la cuota de una regla sin que el
// jefe haya recibido nada.
// ═══════════════════════════════════════════════════════════════════════════

export interface LimiteFrecuencia {
  maxAvisosDia: number;
  minHorasEntreAvisos: number;
}

export const LIMITE_POR_OMISION: LimiteFrecuencia = { maxAvisosDia: 4, minHorasEntreAvisos: 1 };

export const MAX_AVISOS_DIA_TOPE = 24;
export const MIN_HORAS_TOPE = 168;
const HORA_MS = 3_600_000;
const VENTANA_MS = 24 * HORA_MS;

export type VeredictoFrecuencia =
  | { permitido: true }
  | { permitido: false; motivo: 'tope_diario' | 'separacion_minima'; proximoEn: Date; detalle: string };

/** Valida lo que viene de un formulario. Devuelve el error en palabras de pantalla. */
export function validarLimite(cruda: { maxAvisosDia: unknown; minHorasEntreAvisos: unknown }):
  { ok: true; limite: LimiteFrecuencia } | { ok: false; error: string } {
  const max = Number(cruda.maxAvisosDia);
  const min = Number(cruda.minHorasEntreAvisos);
  if (!Number.isInteger(max) || max < 1 || max > MAX_AVISOS_DIA_TOPE) {
    return { ok: false, error: `El máximo de avisos al día va de 1 a ${MAX_AVISOS_DIA_TOPE}.` };
  }
  if (!Number.isInteger(min) || min < 0 || min > MIN_HORAS_TOPE) {
    return { ok: false, error: `La separación entre avisos va de 0 a ${MIN_HORAS_TOPE} horas.` };
  }
  return { ok: true, limite: { maxAvisosDia: max, minHorasEntreAvisos: min } };
}

/**
 * ¿Puede esta regla mandar un aviso AHORA? `enviadosEn` son los instantes de los
 * avisos que sí salieron (cualquier orden; los futuros —reloj desfasado— se
 * ignoran para no bloquear de por vida a una regla).
 */
export function evaluarFrecuencia(
  enviadosEn: readonly Date[], ahora: Date, limite: LimiteFrecuencia,
): VeredictoFrecuencia {
  const pasados = enviadosEn
    .map((d) => d.getTime())
    .filter((t) => Number.isFinite(t) && t <= ahora.getTime())
    .sort((a, b) => a - b);

  const enVentana = pasados.filter((t) => t > ahora.getTime() - VENTANA_MS);
  if (enVentana.length >= limite.maxAvisosDia) {
    // El cupo se libera cuando el aviso que lo deja en `max - 1` sale de la ventana.
    const libera = enVentana[enVentana.length - limite.maxAvisosDia] + VENTANA_MS;
    return {
      permitido: false, motivo: 'tope_diario', proximoEn: new Date(libera),
      detalle: `ya salieron ${enVentana.length} avisos en 24 h (tope ${limite.maxAvisosDia})`,
    };
  }

  const ultimo = pasados.length > 0 ? pasados[pasados.length - 1] : null;
  if (ultimo !== null && limite.minHorasEntreAvisos > 0) {
    const libera = ultimo + limite.minHorasEntreAvisos * HORA_MS;
    if (ahora.getTime() < libera) {
      return {
        permitido: false, motivo: 'separacion_minima', proximoEn: new Date(libera),
        detalle: `el último aviso salió hace menos de ${limite.minHorasEntreAvisos} h`,
      };
    }
  }
  return { permitido: true };
}
