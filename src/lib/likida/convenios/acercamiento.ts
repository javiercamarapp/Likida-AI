import { logger } from '@/lib/logger';
import { dentroDeGeocerca, type GeocercaGeom } from '../conductor/geo';
import { acercarInstrucciones, type ResultadoEnvioInstrucciones } from './envio';
import { leerCandidatosAcercamiento, leerMargenesAcercamiento, leerPosicionesRecientes } from './trabajo';
import type { LadoViaje } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// AL ACERCARSE A LA PLANTA — el barrido que recuerda la calle de instrucciones (engancha al cron `conductor-hitos`).
//
// Cada pasada: los viajes abiertos con convenio ligado y con el aviso de acercamiento por mandar; la última posición
// de su tractor; si está dentro de «radio de la geocerca + margen de acercamiento» de la planta que le toca (la de carga
// hasta que sale de cargar, luego la de descarga) se le mandan SOLO las instrucciones de acercamiento de esa planta,
// una vez (claim en `viaje_convenio`).
//
//   · La posición manda: sin posición reciente (flota sin GPS, poller atrasado) NO se manda nada; no se adivina. El
//     aviso es un recordatorio útil, no un hito: perderlo no perjudica a nadie, mandarlo a destiempo sí confunde.
//   · Una llegada ya registrada (hito de llegada recibido/validado) apaga el aviso: ya está ahí.
//   · Cada viaje es independiente: el fallo de uno no frena a los demás. Reloj de corrida: se corta antes del tope.
// ═══════════════════════════════════════════════════════════════════════════

/** «Ya vas llegando»: cuántos metros ANTES del borde de la geocerca se avisa, de partida. Cada flota lo ajusta en su configuración del Conductor (0604). */
export const MARGEN_ACERCAMIENTO_M = 5_000;
/** Una posición más vieja que esto no dice dónde está el tractor AHORA. */
export const VIGENCIA_POSICION_MIN = 20;
export const TOPE_VIAJES_ACERCAMIENTO = 400;

export interface CandidatoAcercamiento {
  tenantId: string;
  viajeId: string;
  unidadId: string;
  lado: LadoViaje;
  /** Centro + radio, y (0630) el polígono nativo si lo tiene: «cerca» se mide al BORDE de la geocerca. */
  sitio: GeocercaGeom;
}

export interface PosicionUnidad { lat: number; lng: number; medidaEn: Date }

export interface PuertosAcercamiento {
  candidatos(limite: number): Promise<CandidatoAcercamiento[]>;
  /** El margen de acercamiento de cada flota (m). Una flota sin dato en el mapa usa `MARGEN_ACERCAMIENTO_M`. */
  margenes(tenantIds: string[]): Promise<Map<string, number>>;
  /** La última posición de cada unidad desde `desde` (por id de unidad), acotada a las flotas de los candidatos. */
  posiciones(unidadIds: string[], tenantIds: string[], desde: Date): Promise<Map<string, PosicionUnidad>>;
  enviar(tenantId: string, viajeId: string, lado: LadoViaje, ahora: Date): Promise<ResultadoEnvioInstrucciones>;
}

export const puertosAcercamientoReales: PuertosAcercamiento = {
  candidatos: leerCandidatosAcercamiento,
  margenes: leerMargenesAcercamiento,
  posiciones: leerPosicionesRecientes,
  enviar: (t, v, lado, ahora) => acercarInstrucciones(t, v, lado, undefined, ahora),
};

export interface ResultadoAcercamiento {
  candidatos: number;
  enviados: number;
  sinPosicion: number;
  lejos: number;
  rechazados: number;
  fallos: number;
  cortadosPorReloj: number;
}

export function estaCerca(pos: PosicionUnidad, sitio: CandidatoAcercamiento['sitio'], margenM: number = MARGEN_ACERCAMIENTO_M): boolean {
  return dentroDeGeocerca({ lat: pos.lat, lng: pos.lng }, sitio, margenM).dentro;
}

export async function barridoAcercamiento(
  p: PuertosAcercamiento = puertosAcercamientoReales, ahora: Date = new Date(), venceEn?: number,
): Promise<ResultadoAcercamiento> {
  const r: ResultadoAcercamiento = { candidatos: 0, enviados: 0, sinPosicion: 0, lejos: 0, rechazados: 0, fallos: 0, cortadosPorReloj: 0 };
  const candidatos = await p.candidatos(TOPE_VIAJES_ACERCAMIENTO);
  r.candidatos = candidatos.length;
  if (candidatos.length === 0) return r;
  const margenes = await p.margenes([...new Set(candidatos.map((c) => c.tenantId))]);
  const posiciones = await p.posiciones([...new Set(candidatos.map((c) => c.unidadId))], [...new Set(candidatos.map((c) => c.tenantId))], new Date(ahora.getTime() - VIGENCIA_POSICION_MIN * 60_000));

  for (const [i, c] of candidatos.entries()) {
    if (venceEn !== undefined && Date.now() >= venceEn) { r.cortadosPorReloj = candidatos.length - i; break; }
    const pos = posiciones.get(c.unidadId);
    if (!pos) { r.sinPosicion++; continue; }
    if (!estaCerca(pos, c.sitio, margenes.get(c.tenantId) ?? MARGEN_ACERCAMIENTO_M)) { r.lejos++; continue; }
    const res = await p.enviar(c.tenantId, c.viajeId, c.lado, ahora);
    if (res.estado === 'enviado') r.enviados++;
    else if (res.estado === 'rechazado') r.rechazados++;
    else if (res.estado === 'fallo') { r.fallos++; logger.warn('convenios.acercamiento_fallo', { viaje: c.viajeId, motivo: res.motivo }); }
  }
  return r;
}
