import { dentroDeGeocerca, type GeocercaGeom } from './geo';
import { horaMx } from './mensajes';
import { estaPendiente, estaResuelto, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// «FECHA SALIDA» DEL TMS COMO CANDIDATO A HITO `salida_carga` (T-A5-22). Puro, sin I/O, sin IA: solo reglas.
//
// El sistema de despacho de la flota sella la salida del viaje con segundos (`viaje.tms_salida_en`, 0804). Esa marca NO crea el
// hito por sí misma:
//   · se muestra como CANDIDATO («El TMS marca salida a las 10:22») para que la oficina la vea;
//   · si la flota encendió `aplicarSalidaDelTms` (apagada por omisión) se registra `salida_carga` con fuente, interpretación y
//     validación `sistema` — SOLO si el GPS no la contradice;
//   · si hay muestras de GPS que dicen que el tractor SIGUE dentro del sitio de carga después de esa hora, es una DISCREPANCIA:
//     se muestra en el tablero y NO se registra nada (la dirime una persona).
//
// Prioridad: el hito que el chofer, la oficina o el GPS ya registraron nunca se pisa. Es idempotente: una vez registrado el
// hito, la marca del TMS ya no hace nada.
//
// Sin sitio de carga o sin muestras no hay con qué contradecir: la marca del TMS se acepta (es el caso de la flota sin GPS,
// justo la que más lo necesita); con la casilla apagada sigue siendo solo candidato.
// ═══════════════════════════════════════════════════════════════════════════

/** El GPS reporta con retraso y el TMS sella al capturar: una muestra dentro del sitio hasta estos minutos DESPUÉS de la marca no la contradice. */
export const HOLGURA_SALIDA_TMS_MIN = 5;
/** Solo cuentan para contradecir las muestras de hasta estas horas DESPUÉS de la marca: un regreso al patio horas después no es la salida. */
export const VENTANA_CONTRADICCION_H = 2;
/** Una marca más adelantada que esto respecto al reloj no es creíble: se ignora. */
export const MINUTOS_FUTURO_TMS = 5;

export type EstadoSalidaTms = 'sin_marca' | 'ya_registrada' | 'candidato' | 'discrepancia' | 'aplicar';

export interface PosicionSalida { lat: number; lng: number; medidaEn: Date }

export interface EntradaSalidaTms {
  /** `viaje.tms_salida_en` (ISO) o `null`/ausente = el viaje no trae la marca. */
  tmsSalidaEn: string | Date | null | undefined;
  /** El hito `salida_carga` del viaje ya con el perfil aplicado; `undefined` = no existe. */
  hito: Pick<HitoFila, 'estado'> | undefined;
  /** La casilla `aplicarSalidaDelTms` de la flota. */
  aplicar: boolean;
  /** Geometría del sitio de carga; `null` = el viaje no lo tiene (no hay con qué contradecir). */
  sitioCarga: GeocercaGeom | null;
  toleranciaM: number;
  /** Posiciones conocidas de la unidad (una o varias; en cualquier orden). */
  posiciones: readonly PosicionSalida[];
  ahora: Date;
}

export interface DecisionSalidaTms {
  estado: EstadoSalidaTms;
  /** La marca del TMS como instante, si es válida. */
  marca: Date | null;
}

const aFecha = (v: string | Date | null | undefined): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** ¿Hay una muestra dentro del sitio después de la marca (más la holgura) y dentro de la ventana de contradicción? */
export function gpsContradiceSalida(
  marca: Date, sitio: GeocercaGeom | null, posiciones: readonly PosicionSalida[], toleranciaM: number,
): boolean {
  if (!sitio) return false;
  const desde = marca.getTime() + HOLGURA_SALIDA_TMS_MIN * 60_000;
  const hasta = marca.getTime() + VENTANA_CONTRADICCION_H * 3_600_000;
  return posiciones.some((p) => {
    const t = p.medidaEn.getTime();
    return Number.isFinite(t) && t > desde && t <= hasta && dentroDeGeocerca(p, sitio, toleranciaM).dentro;
  });
}

/** La decisión sobre la marca del TMS de UN viaje. Pura; el llamador decide qué hacer con cada estado. */
export function evaluarSalidaTms(e: EntradaSalidaTms): DecisionSalidaTms {
  const marca = aFecha(e.tmsSalidaEn);
  if (!marca) return { estado: 'sin_marca', marca: null };
  if (marca.getTime() > e.ahora.getTime() + MINUTOS_FUTURO_TMS * 60_000) return { estado: 'sin_marca', marca: null };
  // Lo que el chofer, la oficina o el GPS ya dejaron registrado manda: la marca del TMS no lo pisa.
  if (e.hito && estaResuelto(e.hito)) return { estado: 'ya_registrada', marca };
  // Sin hito pendiente (no existe, o la flota no sigue la salida de la carga: omitido) no hay a qué proponer.
  if (!e.hito || !estaPendiente(e.hito)) return { estado: 'sin_marca', marca };
  if (gpsContradiceSalida(marca, e.sitioCarga, e.posiciones, e.toleranciaM)) return { estado: 'discrepancia', marca };
  return { estado: e.aplicar ? 'aplicar' : 'candidato', marca };
}

/** El texto del tablero. Hora en la zona de la flota; sin nombres ni coordenadas. */
export function textoSalidaTms(estado: Extract<EstadoSalidaTms, 'candidato' | 'discrepancia'>, marca: Date, zona: string, sitio: string | null): string {
  const hora = horaMx(marca, zona);
  if (estado === 'discrepancia') {
    return `El TMS marca salida a las ${hora}, pero el GPS sigue dentro de ${sitio ?? 'el sitio de carga'}. No se registró: confírmala con el chofer.`;
  }
  return `El TMS marca salida a las ${hora}`;
}
