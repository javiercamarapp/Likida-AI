import { coordenadasValidas, dentroDeGeocerca, haversineM } from './geo';
import type { MuestraGps, SitiosViaje } from './ciclo_gps';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';

// ═══════════════════════════════════════════════════════════════════════════
// COMPUERTA «UNIDAD DETENIDA» (T-A5-36) — pura, sin I/O.
//
// Requisito del cliente: al chofer NO se le escribe en marcha. La política del cliente es no escribir mientras se maneja, y su
// proveedor de telemática detecta «teléfono en la mano» y levanta una incidencia: mandarle un mensaje con la unidad rodando le da
// el argumento «ustedes me lo mandaron». Por eso todo mensaje PROACTIVO al chofer (solicitud y recordatorios, señal de vida) pasa
// por `puedeEscribirAlChofer` antes de reclamarse y enviarse.
//
// ── REGLAS (en este orden; ante la duda, NO escribe) ───────────────────────
//   1. Compuerta apagada (`compuertaMovimientoActiva` ausente o false, por omisión hasta la fase 2): permitido, igual que siempre.
//   2. Sin una muestra de GPS dentro de `detenidaVentanaMin` → NO (`sin_gps`), salvo `sinGpsPermite = true`.
//   3. El proveedor reporta velocidad sostenida de marcha (`senalExtra`) → NO (`conduciendo`), también dentro de un sitio.
//   4. La última muestra está dentro de un sitio del viaje (patio, andén) → permitido (`dentro_del_sitio`): exenta aunque el GPS
//      impreciso «baile» dentro de la planta.
//   5. Desplazamiento > `detenidaMetros` dentro de la ventana → NO (`en_movimiento`).
//   6. Menos de 3 muestras en la ventana → NO (`pocas_muestras`): una muestra rala no prueba que esté quieta.
//   7. El proveedor reporta ignición encendida (`senalExtra`) fuera de un sitio → NO (`ignicion_encendida`): una detención por
//      tráfico o semáforo no es «estacionado».
//   8. Si no, permitido (`detenida`).
//
// «NO» no es un intento: el planificador NO reclama nada, no consume un recordatorio y la siguiente pasada vuelve a preguntar.
// Sin `senalExtra` (la alimenta T-A5-65) rige la regla solo-GPS, que es la más conservadora.
// Cadencias de muestreo lentas (15 min) se calibran en T-A5-37: aquí, con muestras ralas, la compuerta no deja pasar.
// No se registran coordenadas en ningún log: este módulo no registra nada.
// ═══════════════════════════════════════════════════════════════════════════

export const MIN_MUESTRAS_DETENIDA = 3;
/** Velocidad (km/h) por encima de la cual el proveedor dice «va en marcha». */
export const VELOCIDAD_MARCHA_KMH = 5;
/** Muestras con hora posterior a `ahora` + esto se ignoran (reloj del proveedor adelantado): no pueden probar nada. */
export const MINUTOS_FUTURO_TOLERADO_COMPUERTA = 2;

export type RazonCompuerta =
  | 'compuerta_apagada'
  | 'sin_gps'
  | 'sin_gps_permitido'
  | 'conduciendo'
  | 'dentro_del_sitio'
  | 'en_movimiento'
  | 'pocas_muestras'
  | 'ignicion_encendida'
  | 'detenida';

export interface ResultadoCompuerta {
  permitido: boolean;
  razon: RazonCompuerta;
}

/** Lo que el proveedor de telemática añade a las muestras de GPS (T-A5-65). Sin ello rige la regla solo-GPS. */
export interface SenalExtra {
  /** Ignición actual; `null`/ausente = el proveedor no la reporta (no es lo mismo que apagada). */
  ignicion?: boolean | null;
  /** Velocidad sostenida (km/h); `null`/ausente = no la reporta. */
  velocidadKmh?: number | null;
}

export type ConfigCompuerta = Partial<Pick<ConfigConductor, 'compuertaMovimientoActiva' | 'detenidaMetros' | 'detenidaVentanaMin' | 'sinGpsPermite' | 'toleranciaUbicacionM'>>;

export interface EntradaCompuerta {
  /** Muestras de GPS de la unidad (no pines), en cualquier orden. */
  posiciones: readonly MuestraGps[];
  /** Los sitios del viaje (patio, andén). `null` o sin sitios = no hay exención. */
  sitioDelViaje: SitiosViaje | null;
  config: ConfigCompuerta;
  ahora: Date;
  senalExtra?: SenalExtra | null;
}

const positivo = (v: unknown, defecto: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : defecto);

export function puedeEscribirAlChofer(e: EntradaCompuerta): ResultadoCompuerta {
  if (e.config.compuertaMovimientoActiva !== true) return { permitido: true, razon: 'compuerta_apagada' };

  const metros = positivo(e.config.detenidaMetros, CONFIG_CONDUCTOR_DEFAULT.detenidaMetros ?? 150);
  const ventanaMin = positivo(e.config.detenidaVentanaMin, CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin ?? 5);
  const ahoraMs = e.ahora.getTime();
  if (!Number.isFinite(ahoraMs)) return { permitido: false, razon: 'sin_gps' }; // falla cerrado: sin reloj no se sabe qué es «reciente»

  const desde = ahoraMs - ventanaMin * 60_000;
  const hasta = ahoraMs + MINUTOS_FUTURO_TOLERADO_COMPUERTA * 60_000;
  const ventana = e.posiciones
    .filter((m) => coordenadasValidas(m.lat, m.lng) && Number.isFinite(m.medidaEn.getTime()) && m.medidaEn.getTime() >= desde && m.medidaEn.getTime() <= hasta)
    .sort((a, b) => a.medidaEn.getTime() - b.medidaEn.getTime());

  if (ventana.length === 0) {
    return e.config.sinGpsPermite === true ? { permitido: true, razon: 'sin_gps_permitido' } : { permitido: false, razon: 'sin_gps' };
  }
  const ultima = ventana[ventana.length - 1];

  const v = e.senalExtra?.velocidadKmh;
  if (typeof v === 'number' && Number.isFinite(v) && v > VELOCIDAD_MARCHA_KMH) return { permitido: false, razon: 'conduciendo' };

  const margen = positivo(e.config.toleranciaUbicacionM, 0);
  const sitios = [e.sitioDelViaje?.origen ?? null, e.sitioDelViaje?.destino ?? null];
  if (sitios.some((s) => s !== null && dentroDeGeocerca(ultima, s, margen).dentro)) return { permitido: true, razon: 'dentro_del_sitio' };

  if (ventana.some((m) => haversineM(m, ultima) > metros)) return { permitido: false, razon: 'en_movimiento' };
  if (ventana.length < MIN_MUESTRAS_DETENIDA) return { permitido: false, razon: 'pocas_muestras' };
  if (e.senalExtra?.ignicion === true) return { permitido: false, razon: 'ignicion_encendida' };
  return { permitido: true, razon: 'detenida' };
}
