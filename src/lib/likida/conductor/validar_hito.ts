import { logger } from '@/lib/logger';
import type { ConfigConductor } from './config';
import { aplicarVeredicto, posicionesDeUnidad, sitioDelHito, unidadReportaGps, type ResultadoVeredicto } from './repo_validacion';
import type { ViajeContexto } from './repo';
import type { HitoFila } from './tipos';
import {
  evaluarUbicacion, posicionMasCercanaEnTiempo, type PosicionComparada, type SitioValidable, type Veredicto,
} from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// VALIDAR UN HITO CONTRA LA UBICACIÓN — la orquestación (con puertos).
//
// Se valida la LLEGADA (carga o descarga): «ya llegué» es el hito que se puede
// comparar contra un sitio. Las salidas no se validan: al salir el camión ya se
// está yendo, y compararlo con el andén daría «sin coincidencia» cuando todo está
// bien.
//
// Tres entradas, una sola función:
//   1. al REGISTRAR la llegada (atender.ts): se compara con la mejor posición GPS
//      cercana a la hora del mensaje (si la hay).
//   2. cuando el chofer manda su PIN (atender.ts): se compara con el pin, que es la
//      evidencia más directa.
//   3. el BARRIDO del cron (más abajo): los hitos que quedaron «sin dato» porque el
//      GPS aún no había reportado se reintentan cuando llega la posición.
//
// ── NUNCA LANZA, NUNCA RETRASA EL ACUSE ────────────────────────────────────
// Un fallo aquí (base caída, sitio ilegible) se registra y devuelve `null`: el
// hito del chofer ya está anotado y eso es lo que importa. El veredicto se
// reintenta en el barrido.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsValidacion {
  sitio(tenantId: string, viajeId: string, tipo: HitoFila['tipo']): Promise<SitioValidable | null>;
  posiciones(tenantId: string, unidadId: string, desde: Date, hasta: Date): Promise<PosicionComparada[]>;
  aplicar(tenantId: string, hito: HitoFila, v: Veredicto, ahora: Date): Promise<ResultadoVeredicto>;
  /**
   * ¿La unidad reporta GPS de verdad (alguna muestra que NO sea un pin de WhatsApp desde `desde`)? Sin esta dependencia se
   * trata como «no»: el pin es la única evidencia posible. Con GPS activo, un pin solo NUNCA valida: lo elige el chofer.
   */
  gpsActivo?(tenantId: string, unidadId: string, desde: Date): Promise<boolean>;
}

/** Cuánto atrás se mira si la unidad reporta GPS: más viejo que esto, se considera una unidad sin GPS operativo. */
export const HORAS_HISTORIAL_GPS = 24;

export const depsValidacionReales: DepsValidacion = {
  sitio: sitioDelHito,
  posiciones: posicionesDeUnidad,
  aplicar: aplicarVeredicto,
  gpsActivo: unidadReportaGps,
};

export type ConfigValidacion = Pick<ConfigConductor, 'validarUbicacion' | 'toleranciaUbicacionM' | 'ventanaUbicacionMin' | 'pedirUbicacion'>;

export interface EntradaValidarHito {
  viaje: Pick<ViajeContexto, 'id' | 'tenantId' | 'unidadId'>;
  hito: HitoFila;
  config: ConfigValidacion;
  /** La hora del MENSAJE con el que el chofer reportó el hito. */
  mensajeEn: Date;
  /** El pin que el chofer acaba de mandar, si es el caso (`medidaEn` = su hora de envío). */
  pin?: { lat: number; lng: number; medidaEn: Date } | null;
  ahora: Date;
}

export interface SalidaValidar {
  veredicto: Veredicto;
  /** El nombre del sitio comparado (para decirle al chofer o al jefe contra QUÉ se comparó). */
  sitioNombre: string | null;
  aplicado: ResultadoVeredicto;
  /** `true` = el veredicto es «sin ubicación» y vale la pena pedirle el pin al chofer (hay sitio con qué compararlo). */
  pedirUbicacion: boolean;
}

export const esLlegada = (t: HitoFila['tipo']): boolean => t === 'llegada_carga' || t === 'llegada_descarga';

export async function validarHitoContraSitio(d: DepsValidacion, e: EntradaValidarHito): Promise<SalidaValidar | null> {
  if (!e.config.validarUbicacion || !esLlegada(e.hito.tipo)) return null;
  if (e.hito.estado !== 'recibido' && e.hito.estado !== 'validado') return null;
  try {
    const sitio = await d.sitio(e.viaje.tenantId, e.viaje.id, e.hito.tipo);
    const candidatas: PosicionComparada[] = [];
    if (e.pin) candidatas.push({ lat: e.pin.lat, lng: e.pin.lng, medidaEn: e.pin.medidaEn, fuente: 'pin' });
    // Sin sitio no hace falta ir por el GPS: el veredicto ya es «sin dato».
    if (sitio && e.viaje.unidadId) {
      const margen = e.config.ventanaUbicacionMin * 60_000;
      const gps = await d.posiciones(e.viaje.tenantId, e.viaje.unidadId, new Date(e.mensajeEn.getTime() - margen), new Date(e.mensajeEn.getTime() + margen));
      candidatas.push(...gps);
    }
    // El pin lo ELIGE el chofer («Enviar ubicación» deja marcar cualquier punto del mapa): no es la posición del tractor.
    //   · Hay una muestra de GPS en la ventana → decide el GPS; el pin queda como evidencia, no como candidato.
    //   · No la hay pero la unidad SÍ reporta GPS (poller atrasado) → el pin solo no valida: quedaría «validado» para
    //     siempre (el rango solo sube) aunque después lleguen las posiciones reales. Sin dato; el barrido lo reintenta.
    //   · La unidad no reporta GPS (flota sin conector) → el pin es la única evidencia posible.
    const hayGpsEnVentana = candidatas.some((c) => c.fuente === 'gps');
    let usables = candidatas;
    let pinsDescartados = false;
    if (hayGpsEnVentana) usables = candidatas.filter((c) => c.fuente === 'gps');
    else if (sitio && candidatas.length > 0 && e.viaje.unidadId && d.gpsActivo) {
      const desde = new Date(e.mensajeEn.getTime() - HORAS_HISTORIAL_GPS * 3_600_000);
      if (await d.gpsActivo(e.viaje.tenantId, e.viaje.unidadId, desde)) { usables = []; pinsDescartados = true; }
    }
    const posicion = posicionMasCercanaEnTiempo(usables, e.mensajeEn);
    const veredicto = evaluarUbicacion({
      sitio, posicion, mensajeEn: e.mensajeEn, toleranciaM: e.config.toleranciaUbicacionM, ventanaMin: e.config.ventanaUbicacionMin,
      gpsPendiente: pinsDescartados,
    });
    const aplicado = await d.aplicar(e.viaje.tenantId, e.hito, veredicto, e.ahora);
    logger.info('hito.validacion', { viaje: e.viaje.id, hito: e.hito.tipo, resultado: veredicto.resultado, motivo: veredicto.motivo, aplicado });
    return {
      veredicto, aplicado, sitioNombre: sitio?.nombre ?? null,
      pedirUbicacion: e.config.pedirUbicacion && !e.pin && veredicto.motivo === 'sin_ubicacion' && aplicado !== 'fallo' && aplicado !== 'hito_cambio',
    };
  } catch (err) {
    logger.warn('hito.validacion_fallo', { viaje: e.viaje.id, hito: e.hito.id, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL BARRIDO DEL CRON — reintenta lo que quedó «sin dato».
//
// Los pollers de GPS reportan con minutos de retraso: una llegada anotada a las
// 14:32 puede tener su posición hasta las 14:45. El barrido mira las llegadas
// recientes sin veredicto (o «sin dato» por falta de posición) y vuelve a
// compararlas. SOLO mejora el veredicto (la base lo garantiza): un barrido nunca
// empeora lo que ya se había validado.
// ═══════════════════════════════════════════════════════════════════════════

export interface CandidatoValidacion {
  hito: HitoFila;
  viaje: ViajeContexto;
  /** El veredicto que ya tiene este ciclo, si es uno que vale la pena volver a medir (`sin_coincidencia`). */
  resultadoPrevio?: 'sin_coincidencia' | null;
}

export interface PuertosBarrido {
  candidatos(desde: Date, limite: number): Promise<CandidatoValidacion[]>;
  configDe(tenantId: string): Promise<ConfigConductor>;
  deps: DepsValidacion;
}

export interface ResultadoBarrido {
  revisados: number;
  validados: number;
  sinCoincidencia: number;
  sinDato: number;
  saltados: number;
  fallos: number;
}

/**
 * Cuánto después de cerrarse la ventana de comparación (hora del mensaje + ventana de la flota) todavía puede llegar una
 * muestra de GPS que cuente: el poller reporta con minutos de retraso. Pasado esto, un «sin coincidencia» es definitivo.
 */
export const REZAGO_MAX_GPS_MIN = 30;

/** Hasta cuándo atrás se reintenta una llegada sin dato. */
export const HORAS_REINTENTO_VALIDACION = 3;
export const TOPE_BARRIDO_VALIDACION = 300;

export async function barridoValidacion(p: PuertosBarrido, ahora: Date, venceEn?: number): Promise<ResultadoBarrido> {
  const r: ResultadoBarrido = { revisados: 0, validados: 0, sinCoincidencia: 0, sinDato: 0, saltados: 0, fallos: 0 };
  const candidatos = await p.candidatos(new Date(ahora.getTime() - HORAS_REINTENTO_VALIDACION * 3_600_000), TOPE_BARRIDO_VALIDACION);
  const configs = new Map<string, ConfigConductor | null>();
  for (const c of candidatos) {
    if (venceEn !== undefined && Date.now() >= venceEn) break;
    const tenant = c.viaje.tenantId;
    if (!configs.has(tenant)) {
      try { configs.set(tenant, await p.configDe(tenant)); } catch { configs.set(tenant, null); }
    }
    const config = configs.get(tenant);
    if (!config) { r.fallos++; continue; }
    if (!config.validarUbicacion) { r.saltados++; continue; }
    const mensajeEn = new Date(c.hito.mensajeEn ?? c.hito.recibidoEn ?? ahora);
    // Un «sin coincidencia» puede ser una muestra vieja (el camión aún no llegaba): se reevalúa mientras puedan llegar
    // muestras dentro de la ventana; después es definitivo y no se mide en cada corrida.
    if (c.resultadoPrevio === 'sin_coincidencia'
      && ahora.getTime() > mensajeEn.getTime() + (config.ventanaUbicacionMin + REZAGO_MAX_GPS_MIN) * 60_000) { r.saltados++; continue; }
    r.revisados++;
    const s = await validarHitoContraSitio(p.deps, { viaje: c.viaje, hito: c.hito, config, mensajeEn, ahora });
    if (!s) { r.fallos++; continue; }
    if (s.aplicado === 'mejorado' || s.aplicado === 'nuevo') {
      if (s.veredicto.resultado === 'validado') r.validados++;
      else if (s.veredicto.resultado === 'sin_coincidencia') r.sinCoincidencia++;
      else r.sinDato++;
    } else r.sinDato += s.veredicto.resultado === 'sin_dato' ? 1 : 0;
  }
  return r;
}
