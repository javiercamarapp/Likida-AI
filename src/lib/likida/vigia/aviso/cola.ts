// Cola atorada del aviso de viaje (T-A4-42): cuántos avisos llevan demasiado esperando la confirmación humana.
//
// Función pura y sin logs: recibe lo mínimo de cada aviso pendiente (cuándo nació y la cita del viaje) y devuelve un número.
// Nada del texto, del cliente ni del operador entra aquí, así que nada de eso puede salir a un registro.

/** Un `pendiente_confirmacion` que lleva más de esto sin que nadie lo apruebe o descarte se considera atorado. */
export const HORAS_PENDIENTE_VIEJO = 2;

/**
 * Fallidos en UNA misma pasada a partir de los cuales se avisa al operador del sistema. Uno o dos fallos sueltos (un número
 * sin WhatsApp, una plantilla en revisión) ya quedan visibles en la bandeja y en el latido `parcial`; el correo se reserva
 * para una racha. El correo además tiene piso de una hora por evento (`alertarOperador`), así que no se repite cada pasada.
 */
export const UMBRAL_FALLIDOS_ALERTA = 3;

/** Tope de avisos pendientes que se leen por flota para contarlos (el contador se satura ahí, no revienta la pasada). */
export const TOPE_PENDIENTES_LEIDOS = 500;

export interface PendienteConfirmacion {
  /** ISO de cuando nació el aviso. */
  creadoEn: string;
  /** ISO de la cita del viaje; `null` si el programa no traía hora. */
  cita: string | null;
}

/**
 * Avisos `pendiente_confirmacion` con más de `horas` de antigüedad cuyo viaje AÚN no pasa («dentro del horario»): uno cuya
 * cita ya pasó dejó de ser accionable y no es una cola atorada sino un aviso caducado. Sin cita legible se cuenta.
 */
export function contarPendientesViejos(pendientes: readonly PendienteConfirmacion[], ahora: Date, horas: number = HORAS_PENDIENTE_VIEJO): number {
  const corte = ahora.getTime() - horas * 3_600_000;
  let n = 0;
  for (const p of pendientes) {
    const nacio = Date.parse(p.creadoEn);
    if (Number.isNaN(nacio) || nacio > corte) continue;
    if (p.cita) {
      const cita = Date.parse(p.cita);
      if (!Number.isNaN(cita) && cita < ahora.getTime()) continue;
    }
    n += 1;
  }
  return n;
}
