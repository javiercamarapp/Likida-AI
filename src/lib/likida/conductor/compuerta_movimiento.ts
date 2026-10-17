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
/** T-A5-37: con cadencia lenta (poleo ≥ ventana) dos muestras bastan, pero separadas por un lapso mayor (ver `requisitoDeMuestras`). */
export const MIN_MUESTRAS_DETENIDA_LENTA = 2;
/** T-A5-37: cadencia que se supone al decidir una detención si nadie configuró otra: la lenta (más conservadora). */
export const POLEO_CONSERVADOR_MIN = 15;

/** Cadencia de poleo (min) de una clave (proveedor o unidad) y, si no hay, la de la flota; `undefined` = sin configurar. */
export function poleoEfectivoMin(config: Pick<ConfigCompuerta, 'poleoMin' | 'poleoPorClaveMin'>, ...claves: ReadonlyArray<string | null | undefined>): number | undefined {
  const valido = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  for (const c of claves) {
    const n = c ? config.poleoPorClaveMin?.[c] : undefined;
    if (valido(n)) return n;
  }
  return valido(config.poleoMin) ? config.poleoMin : undefined;
}

/** T-A5-37: el lapso (min) más largo que la compuerta puede pedir con esta config (la cadencia más lenta configurada): cuánto GPS hay que leer. */
export function lapsoMaxCompuertaMin(config: Pick<ConfigCompuerta, 'poleoMin' | 'poleoPorClaveMin' | 'detenidaVentanaMin'>): number {
  const ventana = config.detenidaVentanaMin ?? CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin ?? 5;
  const cadencias = [config.poleoMin, ...Object.values(config.poleoPorClaveMin ?? {})].filter((n): n is number => typeof n === 'number' && n > 0);
  if (cadencias.length === 0) return ventana;
  return Math.max(...cadencias.map((p) => requisitoDeMuestras(p, ventana).lapsoMin));
}

/** T-A5-37: las claves de poleo de una unidad: su id (más específica) y el proveedor de su muestra más reciente. */
export function clavesPoleoDe(unidadId: string | null | undefined, muestras: ReadonlyArray<Pick<MuestraGps, 'medidaEn' | 'proveedor'>>): string[] {
  let proveedor: string | null = null;
  let t = -Infinity;
  for (const m of muestras) {
    const ms = m.medidaEn.getTime();
    if (m.proveedor && ms > t) { t = ms; proveedor = m.proveedor; }
  }
  return [unidadId, proveedor].filter((c): c is string => typeof c === 'string' && c !== '');
}

/**
 * Cuántas muestras y qué lapso (min) hacen falta para dar la unidad por quieta. Sin poleo: la regla de T-A5-36 (3 muestras en la
 * ventana). Con poleo: si la cadencia alcanza a la ventana (la señal llega por rachas lentas) se piden menos muestras
 * (`MIN_MUESTRAS_DETENIDA_LENTA`) pero el lapso crece a `poleo × muestras`; con cadencia rápida se piden las de siempre y el lapso
 * nunca baja de lo que tardan en llegar.
 */
export function requisitoDeMuestras(poleoMin: number | undefined, ventanaMin: number): { muestras: number; lapsoMin: number } {
  if (poleoMin === undefined || !(poleoMin > 0)) return { muestras: MIN_MUESTRAS_DETENIDA, lapsoMin: ventanaMin };
  const muestras = poleoMin >= ventanaMin ? MIN_MUESTRAS_DETENIDA_LENTA : MIN_MUESTRAS_DETENIDA;
  return { muestras, lapsoMin: Math.max(ventanaMin, poleoMin * muestras) };
}

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

export type ConfigCompuerta = Partial<Pick<ConfigConductor, 'compuertaMovimientoActiva' | 'detenidaMetros' | 'detenidaVentanaMin' | 'sinGpsPermite' | 'toleranciaUbicacionM' | 'poleoMin' | 'poleoPorClaveMin' | 'detenidoAvisoMin'>>;

export interface EntradaCompuerta {
  /** Muestras de GPS de la unidad (no pines), en cualquier orden. */
  posiciones: readonly MuestraGps[];
  /** Los sitios del viaje (patio, andén). `null` o sin sitios = no hay exención. */
  sitioDelViaje: SitiosViaje | null;
  config: ConfigCompuerta;
  ahora: Date;
  /** T-A5-37: claves (proveedor o unidad) para buscar la cadencia en `config.poleoPorClaveMin`, de la más a la menos específica. */
  clavesPoleo?: readonly string[];
  senalExtra?: SenalExtra | null;
}

const positivo = (v: unknown, defecto: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : defecto);

export function puedeEscribirAlChofer(e: EntradaCompuerta): ResultadoCompuerta {
  if (e.config.compuertaMovimientoActiva !== true) return { permitido: true, razon: 'compuerta_apagada' };

  const metros = positivo(e.config.detenidaMetros, CONFIG_CONDUCTOR_DEFAULT.detenidaMetros ?? 150);
  const ventanaMin = positivo(e.config.detenidaVentanaMin, CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin ?? 5);
  const ahoraMs = e.ahora.getTime();
  if (!Number.isFinite(ahoraMs)) return { permitido: false, razon: 'sin_gps' }; // falla cerrado: sin reloj no se sabe qué es «reciente»

  const requisito = requisitoDeMuestras(poleoEfectivoMin(e.config, ...(e.clavesPoleo ?? [])), ventanaMin);
  const desde = ahoraMs - requisito.lapsoMin * 60_000;
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
  if (ventana.length < requisito.muestras) return { permitido: false, razon: 'pocas_muestras' };
  if (e.senalExtra?.ignicion === true) return { permitido: false, razon: 'ignicion_encendida' };
  return { permitido: true, razon: 'detenida' };
}

// ═══════════════════════════════════════════════════════════════════════════
// DETENCIÓN ELEGIBLE (T-A5-37) — ¿lleva la unidad quieta el tiempo de `detenidoAvisoMin`? Pura, sin I/O.
//
// Es el umbral CORTO (15 min por omisión) con que T-A5-39 decide preguntarle al chofer por una detención sin aviso; no es la señal
// de vida (`detenidoMin`, 60). La telemática del cliente REGISTRA cada minuto pero a veces RECIBIMOS cada ~15 (la otra plataforma,
// cada ~2): una muestra rala no es movimiento ni prueba de quietud. Por eso se lee `poleoMin` (por proveedor o de la flota; sin
// configurar, la cadencia lenta): la cobertura exigida es `detenidoAvisoMin` con holgura de un poleo, y se piden menos muestras
// (`requisitoDeMuestras`) cuando el poleo es lento. Si el proveedor entrega el búfer de lo registrado cada minuto, las muestras
// traen su hora de medida y simplemente son más; nada cambia aquí. Falla cerrado: ante la duda, NO es elegible.
// ═══════════════════════════════════════════════════════════════════════════

export type RazonDetencion = 'sin_gps' | 'conduciendo' | 'dentro_del_sitio' | 'en_movimiento' | 'pocas_muestras' | 'lapso_corto' | 'detenida';

export interface EntradaDetencion {
  posiciones: readonly MuestraGps[];
  sitioDelViaje: SitiosViaje | null;
  config: ConfigCompuerta;
  ahora: Date;
  /** Claves (proveedor o unidad) para buscar la cadencia en `config.poleoPorClaveMin`, de la más a la menos específica. */
  clavesPoleo?: readonly string[];
  senalExtra?: SenalExtra | null;
}

const entero = (v: unknown, min: number, max: number, defecto: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : defecto);

export function detencionElegible(e: EntradaDetencion): { elegible: boolean; razon: RazonDetencion } {
  const no = (razon: RazonDetencion) => ({ elegible: false, razon });
  const avisoMin = entero(e.config.detenidoAvisoMin, 5, 720, CONFIG_CONDUCTOR_DEFAULT.detenidoAvisoMin ?? 15);
  const poleoMin = poleoEfectivoMin(e.config, ...(e.clavesPoleo ?? [])) ?? POLEO_CONSERVADOR_MIN;
  const metros = positivo(e.config.detenidaMetros, CONFIG_CONDUCTOR_DEFAULT.detenidaMetros ?? 150);
  const ahoraMs = e.ahora.getTime();
  if (!Number.isFinite(ahoraMs)) return no('sin_gps');

  const desde = ahoraMs - (avisoMin + poleoMin) * 60_000;
  const hasta = ahoraMs + MINUTOS_FUTURO_TOLERADO_COMPUERTA * 60_000;
  const ventana = e.posiciones
    .filter((m) => coordenadasValidas(m.lat, m.lng) && Number.isFinite(m.medidaEn.getTime()) && m.medidaEn.getTime() >= desde && m.medidaEn.getTime() <= hasta)
    .sort((a, b) => a.medidaEn.getTime() - b.medidaEn.getTime());
  if (ventana.length === 0) return no('sin_gps');
  const primera = ventana[0];
  const ultima = ventana[ventana.length - 1];
  // La última muestra tiene que ser reciente a la escala de la cadencia: más vieja que dos poleos, la señal se calló (otro asunto).
  if (ahoraMs - ultima.medidaEn.getTime() > 2 * poleoMin * 60_000) return no('sin_gps');

  const v = e.senalExtra?.velocidadKmh;
  if (typeof v === 'number' && Number.isFinite(v) && v > VELOCIDAD_MARCHA_KMH) return no('conduciendo');
  const margen = positivo(e.config.toleranciaUbicacionM, 0);
  const sitios = [e.sitioDelViaje?.origen ?? null, e.sitioDelViaje?.destino ?? null];
  if (sitios.some((s) => s !== null && dentroDeGeocerca(ultima, s, margen).dentro)) return no('dentro_del_sitio');
  if (ventana.some((m) => haversineM(m, ultima) > metros)) return no('en_movimiento');
  if (ventana.length < requisitoDeMuestras(poleoMin, avisoMin).muestras) return no('pocas_muestras');
  // Cobertura: la primera muestra debe estar a ≥ `detenidoAvisoMin` de ahora, con la holgura de un poleo (la siguiente aún no llegó).
  if (ahoraMs - primera.medidaEn.getTime() < (avisoMin - poleoMin) * 60_000) return no('lapso_corto');
  return { elegible: true, razon: 'detenida' };
}
