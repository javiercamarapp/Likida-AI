import { logger } from '@/lib/logger';
import { dentroDeGeocerca, haversineM, type GeocercaGeom } from './geo';
import type { ConfigConductor } from './config';
import { estaPendiente, estaResuelto, type HitoFila, type TipoHito } from './tipos';
import type { ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO POR GEOCERCA — que el sistema se entere solo de que el tractor llegó o salió (P2, ola 4c).
//
// Es el pedido literal del cliente: «que detecte por geocerca que el tractor llegó o salió SIN que el chofer escriba
// nada». El barrido del cron compara las posiciones de GPS de la unidad contra el sitio que el viaje espera y, cuando el
// tractor ENTRA o SALE, registra el hito con fuente `sistema` y lo valida con el GPS (`validado_por = gps`).
//
// Las cuatro detecciones, en el orden del viaje:
//   llegada_carga    → el GPS entra al sitio de ORIGEN y se queda (≥ 2 muestras).
//   salida_carga     → ya estuvo dentro y ahora lleva ≥ 2 muestras fuera.
//   llegada_descarga → entra al sitio de DESTINO (después de salir de la carga) y se queda.
//   salida_descarga  → ya estuvo dentro del destino y lleva ≥ 2 muestras fuera.
// `regreso` no se detecta: no hay sitio contra el cual compararlo.
//
// ── POR QUÉ «≥ 2 MUESTRAS» ──────────────────────────────────────────────────
// Un tractor que PASA por la puerta de una planta a 60 km/h deja una muestra dentro del círculo, no dos: con una sola
// muestra el sistema declararía una llegada que no fue. Dentro o fuera se mide con el helper único `dentroDeGeocerca`
// (polígono nativo si el sitio lo tiene, círculo + tolerancia de la flota si no). Un sitio APROXIMADO (el círculo sustituye
// a un polígono del cliente) pide una muestra más. La salida usa además una holgura de histéresis: el GPS que baila en el
// borde no abre y cierra el hito.
//
// ── LA PRIORIDAD ES DEL CHOFER Y DE LA OFICINA ──────────────────────────────
// El sistema solo llena un hito PENDIENTE (esperado/escalado): lo que el chofer ya reportó o la oficina ya capturó no se
// toca, y un hito que una persona retiró o corrigió no se vuelve a detectar (una detección por (viaje, hito): 0635). Si el
// tractor llega al DESTINO sin que la carga se haya cerrado, los hitos anteriores pendientes pasan a `omitido`, igual que
// cuando el chofer avisa fuera de orden — pero solo si el tractor de verdad VINO de fuera (hubo una muestra fuera antes
// de la entrada) y el origen y el destino no son el mismo sitio.
//
// Pura la decisión (`proximaDeteccion`); el barrido solo orquesta puertos. Contra una base sin la 0635 sigue funcionando:
// el candado entonces es la transición condicional del hito (`esperado → recibido`).
// ═══════════════════════════════════════════════════════════════════════════

/** Muestras seguidas dentro del sitio para dar por hecha una llegada (una sola puede ser un tractor que pasa). */
export const MIN_MUESTRAS_DENTRO = 2;
/** Un sitio aproximado (círculo en vez del polígono real) pide una muestra más. */
export const MIN_MUESTRAS_DENTRO_APROXIMADO = 3;
/** Muestras seguidas fuera para dar por hecha una salida. */
export const MIN_MUESTRAS_FUERA = 2;
/** Metros que se SUMAN a la tolerancia para decir «ya salió»: el GPS que baila en el borde no es una salida. */
export const HISTERESIS_SALIDA_M = 100;
/** Hasta cuántas horas atrás se miran muestras de GPS en cada pasada (el barrido corre cada 5 min: lo importante es lo reciente). */
export const HORAS_VENTANA_GPS = 4;
/** Una muestra más adelantada que esto respecto al reloj del servidor no es creíble. */
export const MINUTOS_FUTURO_TOLERADO = 5;
/** Un claim sin completar más viejo que esto lo retoma otra corrida (la anterior murió a media). */
export const MINUTOS_CLAIM_VENCIDO = 10;
export const TOPE_VIAJES_CICLO_GPS = 400;
/**
 * Un viaje sin actividad (ni aceptación ni hito resuelto) en más horas que esto ya no es «el viaje que la unidad lleva»: si hay
 * otro más reciente de la misma unidad, este cede (el GPS de hoy no es la prueba de un viaje de hace días).
 */
export const HORAS_VIAJE_SIN_ACTIVIDAD = 24;

export interface MuestraGps { lat: number; lng: number; medidaEn: Date }

export interface SitioGps extends GeocercaGeom { id: string; nombre: string }

export interface SitiosViaje { origen: SitioGps | null; destino: SitioGps | null }

export type TipoDeteccion = Extract<TipoHito, 'llegada_carga' | 'salida_carga' | 'llegada_descarga' | 'salida_descarga'>;

export interface Deteccion {
  tipo: TipoDeteccion;
  entrada: boolean;
  sitio: SitioGps;
  /** La hora de la muestra que prueba el cruce. */
  detectadoEn: Date;
  /** Distancia de esa muestra al CENTRO del sitio (m). */
  distanciaM: number;
  /** Hitos anteriores todavía pendientes que esta detección da por omitidos (solo la llegada al destino fuera de orden). */
  omitir: HitoFila[];
  /** La llegada confirma el destino sin pasar por la carga. */
  fueraDeOrden: boolean;
}

// ── Lo puro ─────────────────────────────────────────────────────────────────

const ordenadas = (ms: readonly MuestraGps[]): MuestraGps[] => [...ms].sort((a, b) => a.medidaEn.getTime() - b.medidaEn.getTime());

/**
 * La primera ENTRADA al sitio: la primera racha de muestras consecutivas dentro con `minDentro` o más. `null` = no hay.
 * Con `exigirVinoDeFuera` la racha debe ir precedida de al menos una muestra fuera (el tractor no estaba ya ahí al empezar).
 */
export function buscarEntrada(
  sitio: SitioGps, muestras: readonly MuestraGps[], toleranciaM: number, opts: { desde?: Date; exigirVinoDeFuera?: boolean } = {},
): { detectadoEn: Date; distanciaM: number } | null {
  const min = sitio.aproximada === true ? MIN_MUESTRAS_DENTRO_APROXIMADO : MIN_MUESTRAS_DENTRO;
  const desde = opts.desde?.getTime() ?? -Infinity;
  const lista = ordenadas(muestras).filter((m) => m.medidaEn.getTime() >= desde);
  let racha: MuestraGps[] = [];
  let hubo_fuera = false;
  for (const m of lista) {
    if (dentroDeGeocerca(m, sitio, toleranciaM).dentro) {
      racha.push(m);
      if (racha.length >= min && (!opts.exigirVinoDeFuera || hubo_fuera)) {
        return { detectadoEn: racha[0].medidaEn, distanciaM: Math.round(haversineM(racha[0], sitio)) };
      }
    } else {
      hubo_fuera = true;
      racha = [];
    }
  }
  return null;
}

/**
 * La primera SALIDA: el tractor estuvo dentro (≥ `minDentro` muestras desde `desde`) y después lleva
 * `MIN_MUESTRAS_FUERA` o más muestras seguidas fuera (con la histéresis). La hora es la de la PRIMERA muestra fuera.
 */
export function buscarSalida(
  sitio: SitioGps, muestras: readonly MuestraGps[], toleranciaM: number, desde: Date,
): { detectadoEn: Date; distanciaM: number } | null {
  const min = sitio.aproximada === true ? MIN_MUESTRAS_DENTRO_APROXIMADO : MIN_MUESTRAS_DENTRO;
  const lista = ordenadas(muestras).filter((m) => m.medidaEn.getTime() >= desde.getTime());
  let dentro = 0;
  let fuera: MuestraGps[] = [];
  for (const m of lista) {
    if (dentroDeGeocerca(m, sitio, toleranciaM).dentro) { dentro++; fuera = []; continue; }
    if (dentro < min) continue; // todavía no llegó: estas muestras fuera son la aproximación, no la salida
    if (dentroDeGeocerca(m, sitio, toleranciaM + HISTERESIS_SALIDA_M).dentro) { fuera = []; continue; } // en el borde: ni dentro ni fuera
    fuera.push(m);
    if (fuera.length >= MIN_MUESTRAS_FUERA) return { detectadoEn: fuera[0].medidaEn, distanciaM: Math.round(haversineM(fuera[0], sitio)) };
  }
  return null;
}

const horaDe = (h: HitoFila | undefined): Date | null => {
  const v = h?.mensajeEn ?? h?.recibidoEn ?? null;
  return v ? new Date(v) : null;
};

/**
 * De todos los viajes abiertos con algo pendiente, SOLO UNO por unidad recibe el GPS en esta pasada: el GPS es de la unidad,
 * no del viaje, y darle las mismas muestras a dos viajes sella hitos ya «validados» en el equivocado (que nadie puede revertir).
 * Los viajes de una unidad son secuenciales: el vigente es el MÁS ANTIGUO que sigue con actividad reciente; uno sin actividad
 * en `HORAS_VIAJE_SIN_ACTIVIDAD` cede ante uno más nuevo (el viaje viejo que quedó abierto hasta liquidarse). Si todos están
 * viejos, el más reciente. Los demás esperan: en cuanto el vigente cierra lo detectable, el siguiente ocupa su lugar.
 */
export function elegirViajesVigentes<V extends Pick<ViajeContexto, 'id' | 'tenantId' | 'unidadId' | 'aceptadoEn'>>(
  viajes: readonly V[], hitosDe: (viajeId: string) => readonly HitoFila[], ahora: Date,
): { vigentes: V[]; cedidos: V[] } {
  const porUnidad = new Map<string, V[]>();
  for (const v of viajes) {
    const k = `${v.tenantId}|${v.unidadId}`;
    porUnidad.set(k, [...(porUnidad.get(k) ?? []), v]);
  }
  const t = (v: V): number => (v.aceptadoEn ? new Date(v.aceptadoEn).getTime() : 0);
  const limiteMs = HORAS_VIAJE_SIN_ACTIVIDAD * 3_600_000;
  const vigentes: V[] = [];
  const cedidos: V[] = [];
  for (const grupo of porUnidad.values()) {
    const orden = [...grupo].sort((a, b) => t(a) - t(b) || a.id.localeCompare(b.id));
    const actividad = (v: V): number => Math.max(t(v), ...hitosDe(v.id).filter(estaResuelto).map((h) => horaDe(h)?.getTime() ?? 0));
    const vivos = orden.filter((v) => ahora.getTime() - actividad(v) <= limiteMs);
    const elegido = vivos.length > 0 ? vivos[0] : orden[orden.length - 1];
    for (const v of orden) (v === elegido ? vigentes : cedidos).push(v);
  }
  return { vigentes, cedidos };
}

export interface EntradaProxima {
  hitos: Readonly<Record<TipoDeteccion, HitoFila | undefined>>;
  sitios: SitiosViaje;
  muestras: readonly MuestraGps[];
  config: Pick<ConfigConductor, 'toleranciaUbicacionM' | 'ventanaUbicacionMin'>;
  aceptadoEn: Date | null;
}

/** El hito (si lo hay) que el GPS ya prueba y que sigue pendiente. Una sola detección por llamada: el barrido vuelve a llamar. */
export function proximaDeteccion(e: EntradaProxima): Deteccion | null {
  const { hitos: h, sitios, muestras, config } = e;
  const tol = config.toleranciaUbicacionM;
  const ventanaMs = config.ventanaUbicacionMin * 60_000;
  const desdeAceptado = e.aceptadoEn ?? undefined;
  const pendiente = (x: HitoFila | undefined): x is HitoFila => Boolean(x) && estaPendiente(x as HitoFila);
  const resuelto = (x: HitoFila | undefined): boolean => Boolean(x) && estaResuelto(x as HitoFila);
  const mismoSitio = sitios.origen !== null && sitios.destino !== null && sitios.origen.id === sitios.destino.id;

  // 1. Llegada a la carga: ya estaba ahí al aceptar el viaje o entró después.
  if (pendiente(h.llegada_carga) && sitios.origen) {
    const r = buscarEntrada(sitios.origen, muestras, tol, { desde: desdeAceptado });
    if (r) return { tipo: 'llegada_carga', entrada: true, sitio: sitios.origen, ...r, omitir: [], fueraDeOrden: false };
  }
  // 2. Salida de la carga: la llegada ya está (la dio el chofer, la oficina o el sistema) y el tractor ya se fue.
  if (resuelto(h.llegada_carga) && pendiente(h.salida_carga) && sitios.origen) {
    const t = horaDe(h.llegada_carga);
    const desde = new Date((t?.getTime() ?? e.aceptadoEn?.getTime() ?? 0) - ventanaMs);
    const r = buscarSalida(sitios.origen, muestras, tol, desde);
    if (r) return { tipo: 'salida_carga', entrada: false, sitio: sitios.origen, ...r, omitir: [], fueraDeOrden: false };
  }
  // 3. Llegada a la descarga.
  if (pendiente(h.llegada_descarga) && sitios.destino) {
    if (resuelto(h.salida_carga)) {
      const desde = horaDe(h.salida_carga) ?? desdeAceptado;
      const r = buscarEntrada(sitios.destino, muestras, tol, { desde: desde ?? undefined });
      if (r) return { tipo: 'llegada_descarga', entrada: true, sitio: sitios.destino, ...r, omitir: [], fueraDeOrden: false };
    } else if (!mismoSitio) {
      // La carga no se cerró (el chofer no avisó y el sitio de origen no la detectó): si el tractor VINO de fuera y entró al
      // destino, la carga ya pasó. Los hitos anteriores pendientes se dan por omitidos, como cuando el chofer avisa fuera de orden.
      const r = buscarEntrada(sitios.destino, muestras, tol, { desde: desdeAceptado, exigirVinoDeFuera: true });
      if (r) {
        const omitir = [h.llegada_carga, h.salida_carga].filter(pendiente);
        return { tipo: 'llegada_descarga', entrada: true, sitio: sitios.destino, ...r, omitir, fueraDeOrden: true };
      }
    }
  }
  // 4. Salida de la descarga.
  if (resuelto(h.llegada_descarga) && pendiente(h.salida_descarga) && sitios.destino) {
    const t = horaDe(h.llegada_descarga);
    const desde = new Date((t?.getTime() ?? e.aceptadoEn?.getTime() ?? 0) - ventanaMs);
    const r = buscarSalida(sitios.destino, muestras, tol, desde);
    if (r) return { tipo: 'salida_descarga', entrada: false, sitio: sitios.destino, ...r, omitir: [], fueraDeOrden: false };
  }
  return null;
}

// ── El barrido (con puertos) ────────────────────────────────────────────────

export interface ClaimCruce {
  tenantId: string;
  viajeId: string;
  geocercaId: string;
  hitoTipo: TipoDeteccion;
  tipo: 'entrada' | 'salida';
  detectadoEn: Date;
  distanciaM: number;
}

export type ResultadoReclamo = 'ganado' | 'perdido' | 'sin_tabla' | 'fallo';
export type ResultadoAplicar = 'ok' | 'carrera' | 'fallo';

export interface UnidadDeViaje { tenantId: string; unidadId: string }

export interface PuertosCicloGps {
  viajes(limite: number): Promise<ViajeContexto[]>;
  hitosDe(viajeIds: string[]): Promise<HitoFila[]>;
  configDe(tenantId: string): Promise<ConfigConductor>;
  sitiosDe(viajes: ViajeContexto[]): Promise<Map<string, SitiosViaje>>;
  /** Muestras de GPS de verdad (nunca el pin de WhatsApp) desde `desde`, por unidad, en cualquier orden. */
  muestras(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, MuestraGps[]>>;
  reclamar(c: ClaimCruce, ahora: Date): Promise<ResultadoReclamo>;
  completar(c: ClaimCruce, ahora: Date): Promise<void>;
  liberar(c: ClaimCruce): Promise<void>;
  /** Registra el hito (fuente `sistema`), lo valida por GPS, sella los legados y avisa a la oficina si la flota lo pidió. */
  aplicar(v: ViajeContexto, h: HitoFila, d: Deteccion, config: ConfigConductor, ahora: Date): Promise<ResultadoAplicar>;
}

export interface ResultadoCicloGps {
  viajes: number;
  evaluados: number;
  detectados: number;
  llegadas: number;
  salidas: number;
  fueraDeOrden: number;
  yaDetectados: number;
  sinSitio: number;
  sinMuestras: number;
  /** Viajes con algo pendiente que esperaron porque otro viaje de la misma unidad es el vigente. */
  cedidosAOtroViaje: number;
  fallos: string[];
  cortadosPorReloj: number;
}

const TIPOS: readonly TipoDeteccion[] = ['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga'];

export async function barridoCicloGps(p: PuertosCicloGps, ahora: Date = new Date(), venceEn?: number): Promise<ResultadoCicloGps> {
  const r: ResultadoCicloGps = {
    viajes: 0, evaluados: 0, detectados: 0, llegadas: 0, salidas: 0, fueraDeOrden: 0, yaDetectados: 0, sinSitio: 0, sinMuestras: 0, cedidosAOtroViaje: 0, fallos: [], cortadosPorReloj: 0,
  };
  const viajes = await p.viajes(TOPE_VIAJES_CICLO_GPS);
  r.viajes = viajes.length;
  if (viajes.length === 0) return r;

  // La config, una vez por flota. Si no se puede leer, esa flota no se toca (no se opera con una estrategia que no se consultó).
  const configs = new Map<string, ConfigConductor | null>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try { configs.set(t, await p.configDe(t)); } catch (e) {
      configs.set(t, null);
      logger.error('conductor.ciclo_gps_config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }
  const aptos = viajes.filter((v) => {
    const c = configs.get(v.tenantId);
    return Boolean(c && c.activo && c.detectarHitosGps && v.unidadId && v.aceptadoEn);
  });
  if (aptos.length === 0) return r;

  const hitos = await p.hitosDe(aptos.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);

  // Solo los viajes con algo detectable pendiente y un sitio con qué compararlo piden muestras.
  const sitios = await p.sitiosDe(aptos);
  const conPendiente = aptos.filter((v) => {
    const hs = porViaje.get(v.id) ?? [];
    const s = sitios.get(v.id);
    if (!s || (!s.origen && !s.destino)) { r.sinSitio++; return false; }
    return hs.some((h) => estaPendiente(h) && (TIPOS as readonly string[]).includes(h.tipo));
  });
  // El GPS es de la unidad: solo el viaje vigente de cada unidad lo recibe (ver `elegirViajesVigentes`).
  const { vigentes: candidatos, cedidos } = elegirViajesVigentes(conPendiente, (id) => porViaje.get(id) ?? [], ahora);
  r.cedidosAOtroViaje = cedidos.length;
  if (candidatos.length === 0) return r;

  const desde = new Date(ahora.getTime() - HORAS_VENTANA_GPS * 3_600_000);
  const unidades = new Map<string, UnidadDeViaje>();
  for (const v of candidatos) unidades.set(`${v.tenantId}|${v.unidadId}`, { tenantId: v.tenantId, unidadId: v.unidadId! });
  const muestrasPorUnidad = await p.muestras([...unidades.values()], desde);
  const limite = ahora.getTime() + MINUTOS_FUTURO_TOLERADO * 60_000;

  for (const [i, v] of candidatos.entries()) {
    if (venceEn !== undefined && Date.now() >= venceEn) { r.cortadosPorReloj = candidatos.length - i; break; }
    const config = configs.get(v.tenantId)!;
    const muestras = (muestrasPorUnidad.get(`${v.tenantId}|${v.unidadId}`) ?? []).filter((m) => m.medidaEn.getTime() <= limite);
    if (muestras.length === 0) { r.sinMuestras++; continue; }
    r.evaluados++;

    const local = new Map<TipoDeteccion, HitoFila>();
    for (const h of porViaje.get(v.id) ?? []) if ((TIPOS as readonly string[]).includes(h.tipo)) local.set(h.tipo as TipoDeteccion, h);
    const aceptadoEn = v.aceptadoEn ? new Date(v.aceptadoEn) : null;
    const desdeViaje = aceptadoEn && aceptadoEn.getTime() > desde.getTime() ? aceptadoEn : desde;

    // Hasta cuatro detecciones por viaje y pasada (la llegada y la salida pueden haber ocurrido entre dos barridos).
    for (let vuelta = 0; vuelta < TIPOS.length; vuelta++) {
      const det = proximaDeteccion({
        hitos: Object.fromEntries(TIPOS.map((t) => [t, local.get(t)])) as EntradaProxima['hitos'],
        sitios: sitios.get(v.id)!, muestras: muestras.filter((m) => m.medidaEn.getTime() >= desdeViaje.getTime()), config, aceptadoEn,
      });
      if (!det) break;
      const hito = local.get(det.tipo)!;
      const claim: ClaimCruce = {
        tenantId: v.tenantId, viajeId: v.id, geocercaId: det.sitio.id, hitoTipo: det.tipo, tipo: det.entrada ? 'entrada' : 'salida',
        detectadoEn: det.detectadoEn, distanciaM: det.distanciaM,
      };
      try {
        const gano = await p.reclamar(claim, ahora);
        if (gano === 'perdido') { r.yaDetectados++; break; }
        if (gano === 'fallo') { r.fallos.push(`reclamo ${v.folio ?? v.id}`); break; }
        const res = await p.aplicar(v, hito, det, config, ahora);
        if (res === 'fallo') { await p.liberar(claim); r.fallos.push(`${v.folio ?? v.id}: no se pudo registrar ${det.tipo}`); break; }
        await p.completar(claim, ahora);
        if (res === 'carrera') break; // otro (el chofer, la oficina, otra corrida) lo registró primero: la siguiente pasada relee
        r.detectados++;
        if (det.entrada) r.llegadas++; else r.salidas++;
        if (det.fueraDeOrden) r.fueraDeOrden++;
        local.set(det.tipo, { ...hito, estado: 'validado', fuente: 'sistema', mensajeEn: det.detectadoEn.toISOString(), recibidoEn: ahora.toISOString() });
        for (const o of det.omitir) local.set(o.tipo as TipoDeteccion, { ...o, estado: 'omitido' });
      } catch (e) {
        r.fallos.push(`${v.folio ?? v.id}: ${e instanceof Error ? e.message : 'error inesperado'}`);
        logger.error('conductor.ciclo_gps_viaje_fallo', { viaje: v.id, err: e instanceof Error ? e.message : String(e) });
        break;
      }
    }
  }
  logger.info('conductor.ciclo_gps', { viajes: r.viajes, evaluados: r.evaluados, detectados: r.detectados, fallos: r.fallos.length });
  return r;
}
