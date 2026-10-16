// ═══════════════════════════════════════════════════════════════════════════
// Gancho de aprobación mancomunada (T-A1-39). APAGADO y sin pantalla.
//
// Regla vigente: los importes de un desglose recibido NO se editan; una corrección se hace en el sistema de origen y se
// reimporta (nueva generación con motivo). Este archivo solo deja el CONTRATO por si el dueño pide algún día poder
// modificar un pago: ese cambio exigiría dos personas distintas y quedaría en bitácora.
//
//   · Por defecto está apagado: ninguna solicitud se aprueba, con las personas que sean.
//   · Encendido: hacen falta dos actores DISTINTOS. El mismo actor dos veces no cuenta como dos.
//   · La bitácora anota quién, qué campo y el resultado; JAMÁS el importe (ni el anterior ni el nuevo).
//   · Nada del sistema lo importa todavía: la prueba `guardia_sin_edicion.test.ts` lo vigila.
// ═══════════════════════════════════════════════════════════════════════════

/** Los campos de importe de un desglose recibido. */
export type CampoImporte = 'concepto' | 'monto' | 'total' | 'neto';

export interface ConfigAprobacionMancomunada { activa: boolean }
/** Lo que vale mientras el dueño no pida nada: apagado. */
export const CONFIG_APROBACION_MANCOMUNADA_POR_DEFECTO: ConfigAprobacionMancomunada = { activa: false };

export interface SolicitudCambioImporte {
  liquidacionId: string;
  campo: CampoImporte;
  /** Quién pide el cambio (cuenta como la primera persona). */
  solicitanteId: string;
  motivo: string;
}

export type MotivoRechazoMancomunado = 'apagada' | 'motivo_vacio' | 'falta_segundo_actor' | 'mismo_actor';

export type ResultadoAprobacion =
  | { estado: 'aprobada'; actores: [string, string] }
  | { estado: 'rechazada'; motivo: MotivoRechazoMancomunado };

/** Evento de bitácora: sin importes, solo quién y qué campo. */
export interface EventoAprobacionMancomunada {
  liquidacionId: string;
  campo: CampoImporte;
  actores: string[];
  resultado: 'aprobada' | MotivoRechazoMancomunado;
}

export interface DependenciasAprobacion {
  config: ConfigAprobacionMancomunada;
  bitacora: (e: EventoAprobacionMancomunada) => Promise<void>;
}

const normalizar = (id: string): string => id.trim().toLowerCase();

/**
 * Decide si un cambio de importe queda aprobado. `aprobadores` son las personas que dieron su visto bueno además de quien lo
 * pidió. Siempre deja un evento de bitácora, aprobado o no.
 */
export async function evaluarAprobacionMancomunada(
  deps: DependenciasAprobacion, solicitud: SolicitudCambioImporte, aprobadores: string[],
): Promise<ResultadoAprobacion> {
  const actores = [...new Set([solicitud.solicitanteId, ...aprobadores].map(normalizar).filter((a) => a !== ''))];
  const cerrar = async (r: ResultadoAprobacion): Promise<ResultadoAprobacion> => {
    await deps.bitacora({
      liquidacionId: solicitud.liquidacionId, campo: solicitud.campo, actores,
      resultado: r.estado === 'aprobada' ? 'aprobada' : r.motivo,
    });
    return r;
  };
  if (!deps.config.activa) return cerrar({ estado: 'rechazada', motivo: 'apagada' });
  if (solicitud.motivo.trim() === '') return cerrar({ estado: 'rechazada', motivo: 'motivo_vacio' });
  if (actores.length >= 2) return cerrar({ estado: 'aprobada', actores: [actores[0], actores[1]] });
  // Una sola persona distinta: ¿nadie más opinó, o la misma persona firmó otra vez?
  return cerrar({ estado: 'rechazada', motivo: aprobadores.length > 0 ? 'mismo_actor' : 'falta_segundo_actor' });
}

/** Doble en memoria para pruebas: acumula los eventos. */
export function crearBitacoraEnMemoria(): { eventos: EventoAprobacionMancomunada[]; bitacora: DependenciasAprobacion['bitacora'] } {
  const eventos: EventoAprobacionMancomunada[] = [];
  return { eventos, bitacora: async (e) => { eventos.push(e); } };
}
