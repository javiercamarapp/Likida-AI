import { coordenadasValidas, haversineM, type Punto } from './geo';

// ═══════════════════════════════════════════════════════════════════════════
// VALIDAR UN HITO CONTRA LA UBICACIÓN — la decisión pura (sin I/O).
//
// Entra: la posición con la que se compara (pin de WhatsApp o última posición
// de GPS), el sitio que el viaje espera y la tolerancia de la flota. Sale uno de
// tres veredictos:
//
//   validado          la posición cae dentro del radio del sitio MÁS la tolerancia.
//   sin_coincidencia  hay posición y hay sitio, y la posición cae fuera.
//   sin_dato          NO se puede decir ni sí ni no: no hay sitio asignado, no hay
//                     posición, la posición es de otra hora o sus coordenadas no
//                     son coordenadas.
//
// ── POR QUÉ «SIN COINCIDENCIA» NO ACUSA ────────────────────────────────────
// Que la posición no caiga en el sitio puede ser culpa del chofer, del GPS
// (una muestra vieja, un túnel), del pin (mandado desde la caseta de la
// entrada) o del CATÁLOGO (el radio o las coordenadas del sitio están mal). El
// veredicto lo dice con esas palabras —«la posición comparada no cae en el sitio
// registrado»— y no cambia el estado del hito: solo `validado` lo mueve.
// «Sin dato» es lo que se dice cuando el dato no alcanza: jamás se convierte en
// «sin coincidencia» por defecto.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoValidacion = 'validado' | 'sin_coincidencia' | 'sin_dato';
export type MotivoSinDato = 'sin_sitio' | 'sin_ubicacion' | 'ubicacion_fuera_de_ventana' | 'coordenadas_invalidas';
export type FuenteUbicacion = 'pin' | 'gps';

export interface SitioValidable {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  radioM: number;
}

export interface PosicionComparada extends Punto {
  /** El instante en que se MIDIÓ la posición (no el de la llegada del mensaje). */
  medidaEn: Date;
  fuente: FuenteUbicacion;
}

export interface EntradaValidacion {
  sitio: SitioValidable | null;
  posicion: PosicionComparada | null;
  /** La hora del mensaje del chofer. */
  mensajeEn: Date;
  /** Metros que se suman al radio. */
  toleranciaM: number;
  /** Diferencia máxima, en minutos, entre la hora del mensaje y la de la posición. */
  ventanaMin: number;
  /** Se descartó un pin porque la unidad reporta GPS y la muestra aún no llega: sin posición, pero «esperando al GPS». */
  gpsPendiente?: boolean;
}

export interface Veredicto {
  resultado: ResultadoValidacion;
  motivo: MotivoSinDato | null;
  fuente: FuenteUbicacion | null;
  /** Distancia al CENTRO del sitio, en metros enteros. null si no se midió. */
  distanciaM: number | null;
  toleranciaM: number;
  radioM: number | null;
  sitioId: string | null;
  medidaEn: Date | null;
}

const sinDato = (e: EntradaValidacion, motivo: MotivoSinDato): Veredicto => ({
  resultado: 'sin_dato', motivo, fuente: e.posicion?.fuente ?? null, distanciaM: null, toleranciaM: e.toleranciaM,
  radioM: e.sitio?.radioM ?? null, sitioId: e.sitio?.id ?? null, medidaEn: e.posicion?.medidaEn ?? null,
});

export function evaluarUbicacion(e: EntradaValidacion): Veredicto {
  if (!e.sitio) return sinDato(e, 'sin_sitio');
  if (!coordenadasValidas(e.sitio.lat, e.sitio.lng)) return sinDato(e, 'sin_sitio');
  if (!e.posicion) return sinDato(e, e.gpsPendiente ? 'ubicacion_fuera_de_ventana' : 'sin_ubicacion');
  if (!coordenadasValidas(e.posicion.lat, e.posicion.lng)) return sinDato(e, 'coordenadas_invalidas');
  const t = e.posicion.medidaEn.getTime();
  if (!Number.isFinite(t) || !Number.isFinite(e.mensajeEn.getTime())) return sinDato(e, 'ubicacion_fuera_de_ventana');
  if (Math.abs(t - e.mensajeEn.getTime()) > e.ventanaMin * 60_000) return sinDato(e, 'ubicacion_fuera_de_ventana');

  const distanciaM = Math.round(haversineM(e.posicion, e.sitio));
  const dentro = distanciaM <= e.sitio.radioM + e.toleranciaM;
  return {
    resultado: dentro ? 'validado' : 'sin_coincidencia', motivo: null, fuente: e.posicion.fuente, distanciaM,
    toleranciaM: e.toleranciaM, radioM: e.sitio.radioM, sitioId: e.sitio.id, medidaEn: e.posicion.medidaEn,
  };
}

/** Elige, entre las posiciones disponibles, la MÁS CERCANA EN EL TIEMPO a la hora del mensaje (nunca «la última»). */
export function posicionMasCercanaEnTiempo(
  posiciones: readonly PosicionComparada[], mensajeEn: Date,
): PosicionComparada | null {
  let mejor: PosicionComparada | null = null;
  let mejorDt = Infinity;
  for (const p of posiciones) {
    const dt = Math.abs(p.medidaEn.getTime() - mensajeEn.getTime());
    if (!Number.isFinite(dt)) continue;
    // Empate: el pin (lo mandó el chofer en ese momento) gana al GPS.
    if (dt < mejorDt || (dt === mejorDt && mejor && mejor.fuente === 'gps' && p.fuente === 'pin')) { mejor = p; mejorDt = dt; }
  }
  return mejor;
}

/** Una línea para el tablero y el aviso: dice QUÉ pasó sin culpar a nadie. */
export function textoVeredicto(v: Veredicto, sitioNombre: string | null): string {
  const sitio = sitioNombre ? ` de «${sitioNombre}»` : ' del sitio registrado';
  const por = v.fuente === 'pin' ? 'el pin que compartió el chofer' : 'la posición del GPS';
  switch (v.resultado) {
    case 'validado':
      return `Coincide con el sitio${sitioNombre ? ` «${sitioNombre}»` : ''} (a ${v.distanciaM} m del centro, según ${por}).`;
    case 'sin_coincidencia':
      return `La posición comparada (${por}) cae a ${v.distanciaM} m del centro${sitio}, fuera de su radio. Puede ser una muestra vieja, otra entrada del mismo sitio o un radio mal capturado: revísalo antes de dar por mala la llegada.`;
    case 'sin_dato':
      switch (v.motivo) {
        case 'sin_sitio': return 'Sin dato: el viaje no tiene sitio asignado para comparar.';
        case 'sin_ubicacion': return 'Sin dato: todavía no hay una posición (pin o GPS) cercana a la hora del aviso.';
        case 'ubicacion_fuera_de_ventana': return 'Sin dato: la posición disponible es de otra hora y no sirve para comparar.';
        default: return 'Sin dato: las coordenadas recibidas no son válidas.';
      }
  }
}
