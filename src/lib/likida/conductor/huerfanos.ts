import { logger } from '@/lib/logger';
import {
  buscarEntrada, buscarSalida, HORAS_VENTANA_GPS, MINUTOS_FUTURO_TOLERADO, TOPE_VIAJES_CICLO_GPS,
  type ClaimCruce, type Deteccion, type MuestraGps, type PuertosCicloGps, type SitioGps, type SitiosViaje, type TipoDeteccion, type UnidadDeViaje,
} from './ciclo_gps';
import { aplicarPerfil } from './perfil';
import { estaPendiente, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EVENTOS DE GEOCERCA SIN VIAJE ABIERTO (T-A5-66): guardarlos como huérfanos y reconciliarlos.
//
// El cliente pidió que la geocerca registre la llegada SIN macro y sin depender del Carta Porte: llegada y salida de carga, llegada y
// salida de destino y entrada al patio de la frontera para su turno (d445f2d3 43:56). Hoy el barrido (`ciclo_gps.ts`) parte de los viajes
// abiertos: si el viaje se cerró antes de tiempo —o todavía no existe— cuando la unidad cruza un sitio conocido, el cruce se pierde
// («el sistema ya no encuentra un viaje abierto», d445f2d3 43:28–46:50 y 46:18).
//
// Dos pasos, los dos tras el barrido de viajes y con la misma pasada del cron:
//   1. SIN VIAJE: de las unidades de las flotas que lo encendieron y que NO tienen un viaje abierto, se detecta la entrada y la salida de
//      cada sitio del catálogo (las mismas reglas de «≥ 2 muestras» y de histéresis del ciclo normal) y se guarda como huérfano. El cruce
//      de un sitio es un estado (dentro | fuera): solo se guarda el CAMBIO respecto del último guardado, así la ventana de GPS que se
//      desliza cada 5 min no repite el mismo cruce.
//   2. RECONCILIAR: cuando un viaje abierto aparece (importación del TMS, complemento o reapertura), los huérfanos de su unidad que
//      cuadran —misma referencia de despacho, o sin referencia y dentro de `VENTANA_RECONCILIACION_H` horas antes de aceptarse— se
//      convierten en hitos por el MISMO camino que el barrido en vivo (reclamo `viaje_cruce_geocerca` + registro condicional del hito:
//      no duplica y nunca pisa lo que el chofer o la oficina ya dieron) y el huérfano queda marcado reconciliado.
//
// NUNCA le escribe al chofer ni a la oficina: no avisa. Sin coordenadas en la tabla ni en los logs (solo sitio, hora y sentido).
// Por flota nace APAGADO (`registrar_geocerca_huerfana`, 0820). La entrada a un sitio que no es el origen ni el destino del viaje (el patio
// de la frontera) queda como evento propio: se conserva hasta que vence la retención.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuánto se conserva un huérfano (días); la purga diaria del mantenimiento la aplica (`purgar_eventos_geocerca_huerfanos`). */
export const RETENCION_DIAS_HUERFANOS = 30;
/** Un huérfano sin referencia de despacho cuadra con un viaje si ocurrió hasta estas horas antes de que el viaje se aceptara. */
export const VENTANA_RECONCILIACION_H = 12;
/** Tope de huérfanos pendientes que una pasada lee para reconciliar. */
export const TOPE_HUERFANOS_PENDIENTES = 500;

export type SentidoCruce = 'entrada' | 'salida';

export interface EventoNuevo {
  tenantId: string;
  unidadId: string;
  geocercaId: string;
  tipo: SentidoCruce;
  en: Date;
  distanciaM: number | null;
  despachoRef: string | null;
}

export interface EventoHuerfano extends EventoNuevo { id: string }

/** El último cruce guardado de una unidad en un sitio: de él depende qué cambio sigue. */
export interface UltimoCruce { tipo: SentidoCruce; en: Date }

// ── Lo puro ─────────────────────────────────────────────────────────────────

const refDeMuestra = (muestras: readonly MuestraGps[], en: Date): string | null =>
  muestras.find((m) => m.medidaEn.getTime() === en.getTime())?.despachoRef ?? null;

/**
 * Los cruces NUEVOS de una unidad sin viaje: por cada sitio, si el último guardado fue una salida (o no hay) busca la entrada; si el último
 * fue una entrada (o no hay) busca la salida. Una entrada exige que la unidad VENGA de fuera (una unidad estacionada dentro del sitio al
 * empezar la ventana no «entra»). Pura: no lee ni escribe nada.
 */
export function detectarCrucesSinViaje(e: {
  tenantId: string; unidadId: string; sitios: readonly SitioGps[]; muestras: readonly MuestraGps[];
  ultimo: ReadonlyMap<string, UltimoCruce>; toleranciaM: number;
}): EventoNuevo[] {
  const nuevos: EventoNuevo[] = [];
  for (const sitio of e.sitios) {
    let estado: UltimoCruce | undefined = e.ultimo.get(sitio.id);
    if (!estado || estado.tipo === 'salida') {
      const ent = buscarEntrada(sitio, e.muestras, e.toleranciaM, { desde: estado?.en, exigirVinoDeFuera: true });
      if (ent && (!estado || ent.detectadoEn.getTime() > estado.en.getTime())) {
        nuevos.push({ tenantId: e.tenantId, unidadId: e.unidadId, geocercaId: sitio.id, tipo: 'entrada', en: ent.detectadoEn, distanciaM: ent.distanciaM, despachoRef: refDeMuestra(e.muestras, ent.detectadoEn) });
        estado = { tipo: 'entrada', en: ent.detectadoEn };
      }
    }
    if (!estado || estado.tipo === 'entrada') {
      const sal = buscarSalida(sitio, e.muestras, e.toleranciaM, estado?.en ?? new Date(0));
      if (sal && (!estado || sal.detectadoEn.getTime() > estado.en.getTime())) {
        nuevos.push({ tenantId: e.tenantId, unidadId: e.unidadId, geocercaId: sitio.id, tipo: 'salida', en: sal.detectadoEn, distanciaM: sal.distanciaM, despachoRef: refDeMuestra(e.muestras, sal.detectadoEn) });
      }
    }
  }
  return nuevos;
}

/**
 * Los hitos a los que puede corresponder un cruce, en el orden del viaje. Origen y destino distintos: uno solo. Si son el mismo sitio, la
 * entrada puede ser la llegada a la carga o a la descarga (y la salida igual): el primero que siga pendiente.
 */
export function hitosDeCruce(ev: Pick<EventoNuevo, 'geocercaId' | 'tipo'>, sitios: SitiosViaje): Array<{ tipo: TipoDeteccion; sitio: SitioGps }> {
  const entrada = ev.tipo === 'entrada';
  const salida: Array<{ tipo: TipoDeteccion; sitio: SitioGps }> = [];
  if (sitios.origen?.id === ev.geocercaId) salida.push({ tipo: entrada ? 'llegada_carga' : 'salida_carga', sitio: sitios.origen });
  if (sitios.destino?.id === ev.geocercaId) salida.push({ tipo: entrada ? 'llegada_descarga' : 'salida_descarga', sitio: sitios.destino });
  return salida;
}

/**
 * Los huérfanos que le tocan a un viaje: misma flota y unidad; si los dos traen referencia de despacho, solo si es la misma (el cruce de
 * otro despacho no es de este viaje); si falta alguna, por ventana (de `VENTANA_RECONCILIACION_H` horas antes de aceptarse el viaje en adelante).
 * De los más viejos a los más nuevos.
 */
export function huerfanosDelViaje(
  v: { tenantId: string; unidadId: string | null; aceptadoEn: string | null; despachoRef?: string | null },
  eventos: readonly EventoHuerfano[],
): EventoHuerfano[] {
  const aceptado = v.aceptadoEn ? new Date(v.aceptadoEn).getTime() : NaN;
  const desde = aceptado - VENTANA_RECONCILIACION_H * 3_600_000;
  return eventos
    .filter((ev) => {
      if (ev.tenantId !== v.tenantId || ev.unidadId !== v.unidadId) return false;
      if (v.despachoRef && ev.despachoRef) return ev.despachoRef === v.despachoRef;
      return Number.isFinite(desde) && ev.en.getTime() >= desde;
    })
    .sort((a, b) => a.en.getTime() - b.en.getTime() || a.id.localeCompare(b.id));
}

// ── El barrido (con puertos) ────────────────────────────────────────────────

/** Lo que el barrido de huérfanos necesita ADEMÁS de los puertos del ciclo por geocerca (viajes, hitos, config, sitios, muestras, reclamo y aplicar). */
export interface PuertosHuerfanos {
  /** Unidades activas de esas flotas SIN viaje abierto (el viaje abierto de una unidad es el que el ciclo por geocerca ya atiende). */
  unidadesSinViaje(tenantIds: string[], limite: number): Promise<UnidadDeViaje[]>;
  /** Los sitios del catálogo del Conductor de cada flota, con geometría. */
  sitiosDeFlotas(tenantIds: string[]): Promise<Map<string, SitioGps[]>>;
  /** Último cruce guardado por unidad (`<flota>|<unidad>`) y sitio. */
  ultimosCruces(unidades: UnidadDeViaje[]): Promise<Map<string, Map<string, UltimoCruce>>>;
  /** Guarda sin duplicar (misma flota, unidad, sitio, sentido y hora = la misma fila). Devuelve cuántos eran nuevos. */
  guardar(eventos: EventoNuevo[]): Promise<number>;
  /** Huérfanos aún sin reconciliar de esas unidades, dentro de la retención. */
  pendientes(unidades: UnidadDeViaje[], limite: number): Promise<EventoHuerfano[]>;
  marcarReconciliados(tenantId: string, ids: string[], viajeId: string, ahora: Date): Promise<void>;
}

export interface ResultadoHuerfanos {
  flotas: number;
  unidades: number;
  guardados: number;
  pendientes: number;
  /** Hitos que la reconciliación creó. */
  hitosCreados: number;
  /** Huérfanos que quedaron ligados a un viaje (con hito creado o con el hito ya dado por otro). */
  reconciliados: number;
  fallos: string[];
  cortadosPorReloj: number;
}

const vacio = (): ResultadoHuerfanos => ({ flotas: 0, unidades: 0, guardados: 0, pendientes: 0, hitosCreados: 0, reconciliados: 0, fallos: [], cortadosPorReloj: 0 });
const llave = (u: { tenantId: string; unidadId: string }): string => `${u.tenantId}|${u.unidadId}`;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function barridoHuerfanos(
  p: PuertosCicloGps, x: PuertosHuerfanos, ahora: Date = new Date(), venceEn?: number,
): Promise<ResultadoHuerfanos> {
  const r = vacio();
  if (!p.flotasConHuerfanos) return r;
  const habilitadas = [...new Set(await p.flotasConHuerfanos())];
  r.flotas = habilitadas.length;
  if (habilitadas.length === 0) return r;
  const vencido = (): boolean => venceEn !== undefined && Date.now() >= venceEn;

  // La config, una vez por flota: una flota apagada o sin leer no se toca (no se opera con una estrategia que no se consultó).
  const configs = new Map<string, Awaited<ReturnType<PuertosCicloGps['configDe']>>>();
  for (const t of habilitadas) {
    try {
      const c = await p.configDe(t);
      if (c.activo && c.detectarHitosGps) configs.set(t, c);
    } catch (e) {
      r.fallos.push(`huérfanos: config ilegible de una flota`);
      logger.error('conductor.huerfanos_config_ilegible', { tenant: t, err: msg(e) });
    }
  }
  const flotas = [...configs.keys()];
  if (flotas.length === 0) return r;

  await guardarSinViaje(p, x, flotas, configs, ahora, r, vencido);
  if (!vencido()) await reconciliar(p, x, configs, ahora, r, vencido);
  else r.cortadosPorReloj++;
  logger.info('conductor.huerfanos', { flotas: r.flotas, unidades: r.unidades, guardados: r.guardados, hitos: r.hitosCreados, reconciliados: r.reconciliados, fallos: r.fallos.length });
  return r;
}

async function guardarSinViaje(
  p: PuertosCicloGps, x: PuertosHuerfanos, flotas: string[],
  configs: Map<string, Awaited<ReturnType<PuertosCicloGps['configDe']>>>, ahora: Date, r: ResultadoHuerfanos, vencido: () => boolean,
): Promise<void> {
  try {
    const unidades = await x.unidadesSinViaje(flotas, TOPE_VIAJES_CICLO_GPS);
    r.unidades = unidades.length;
    if (unidades.length === 0) return;
    const desde = new Date(ahora.getTime() - HORAS_VENTANA_GPS * 3_600_000);
    const limite = ahora.getTime() + MINUTOS_FUTURO_TOLERADO * 60_000;
    const [sitios, muestras, ultimos] = await Promise.all([x.sitiosDeFlotas(flotas), p.muestras(unidades, desde), x.ultimosCruces(unidades)]);
    const nuevos: EventoNuevo[] = [];
    for (const u of unidades) {
      if (vencido()) { r.cortadosPorReloj++; break; }
      const delSitio = sitios.get(u.tenantId) ?? [];
      const ms = (muestras.get(llave(u)) ?? []).filter((m) => m.medidaEn.getTime() <= limite);
      if (delSitio.length === 0 || ms.length === 0) continue;
      nuevos.push(...detectarCrucesSinViaje({
        tenantId: u.tenantId, unidadId: u.unidadId, sitios: delSitio, muestras: ms,
        ultimo: ultimos.get(llave(u)) ?? new Map(), toleranciaM: configs.get(u.tenantId)!.toleranciaUbicacionM,
      }));
    }
    if (nuevos.length > 0) r.guardados = await x.guardar(nuevos);
  } catch (e) {
    r.fallos.push(`huérfanos (guardar): ${msg(e)}`);
    logger.error('conductor.huerfanos_guardar_fallo', { err: msg(e) });
  }
}

async function reconciliar(
  p: PuertosCicloGps, x: PuertosHuerfanos,
  configs: Map<string, Awaited<ReturnType<PuertosCicloGps['configDe']>>>, ahora: Date, r: ResultadoHuerfanos, vencido: () => boolean,
): Promise<void> {
  try {
    // Los viajes abiertos (y aceptados) de las flotas que lo encendieron: contra ellos se ligan los huérfanos de su unidad.
    const viajes = (await p.viajes(TOPE_VIAJES_CICLO_GPS)).filter((v) => configs.has(v.tenantId) && v.unidadId && v.aceptadoEn);
    if (viajes.length === 0) return;
    const unidades = [...new Map(viajes.map((v) => [llave({ tenantId: v.tenantId, unidadId: v.unidadId! }), { tenantId: v.tenantId, unidadId: v.unidadId! }])).values()];
    const pendientes = await x.pendientes(unidades, TOPE_HUERFANOS_PENDIENTES);
    r.pendientes = pendientes.length;
    if (pendientes.length === 0) return;
    const conHuerfanos = new Set(pendientes.map(llave));
    const aLigar = viajes
      .filter((v) => conHuerfanos.has(llave({ tenantId: v.tenantId, unidadId: v.unidadId! })))
      .sort((a, b) => new Date(a.aceptadoEn!).getTime() - new Date(b.aceptadoEn!).getTime() || a.id.localeCompare(b.id));
    if (aLigar.length === 0) return;

    const hitos = await p.hitosDe(aLigar.map((v) => v.id));
    const porViaje = new Map<string, HitoFila[]>();
    for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);
    const sitios = await p.sitiosDe(aLigar);
    const consumidos = new Set<string>();

    for (const [i, v] of aLigar.entries()) {
      if (vencido()) { r.cortadosPorReloj += aLigar.length - i; break; }
      const config = configs.get(v.tenantId)!;
      const sitiosViaje: SitiosViaje = sitios.get(v.id) ?? { origen: null, destino: null };
      const local = new Map<string, HitoFila>();
      for (const h of aplicarPerfil(porViaje.get(v.id) ?? [], config.perfilSeguimiento)) local.set(h.tipo, h);
      const propios = huerfanosDelViaje(v, pendientes.filter((ev) => !consumidos.has(ev.id)));
      const ligados: string[] = [];

      for (const ev of propios) {
        const candidatos = hitosDeCruce(ev, sitiosViaje).filter((c) => local.has(c.tipo));
        if (candidatos.length === 0) continue; // otro sitio (p. ej. el patio de la frontera): sigue como evento propio
        const elegido = candidatos.find((c) => estaPendiente(local.get(c.tipo)!));
        if (!elegido) { ligados.push(ev.id); continue; } // el hito ya lo dio otro (o la flota no lo sigue): no se duplica
        const hito = local.get(elegido.tipo)!;
        const det: Deteccion = {
          tipo: elegido.tipo, entrada: ev.tipo === 'entrada', sitio: elegido.sitio, detectadoEn: ev.en, distanciaM: ev.distanciaM ?? 0, omitir: [], fueraDeOrden: false,
        };
        const claim: ClaimCruce = {
          tenantId: v.tenantId, viajeId: v.id, geocercaId: elegido.sitio.id, hitoTipo: elegido.tipo, tipo: det.entrada ? 'entrada' : 'salida', detectadoEn: ev.en, distanciaM: det.distanciaM,
        };
        try {
          const gano = await p.reclamar(claim, ahora);
          if (gano === 'fallo') { r.fallos.push(`huérfanos: reclamo ${v.folio ?? v.id}`); continue; }
          if (gano === 'perdido') { ligados.push(ev.id); continue; }
          // Es un relleno histórico: la oficina NO se entera de una llegada o salida de hace horas como si acabara de pasar.
          const res = await p.aplicar(v, hito, det, { ...config, avisarOficinaLlegada: false, avisarOficinaSalida: false }, ahora);
          if (res === 'fallo') { await p.liberar(claim); r.fallos.push(`huérfanos: ${v.folio ?? v.id}: no se pudo registrar ${det.tipo}`); continue; }
          await p.completar(claim, ahora);
          ligados.push(ev.id);
          if (res === 'ok') {
            r.hitosCreados++;
            logger.info('conductor.huerfanos_hito', { viaje: v.id, hito: det.tipo });
            local.set(det.tipo, { ...hito, estado: 'validado', fuente: 'sistema', mensajeEn: ev.en.toISOString(), recibidoEn: ahora.toISOString() });
          }
        } catch (e) {
          r.fallos.push(`huérfanos: ${v.folio ?? v.id}: ${msg(e)}`);
          logger.error('conductor.huerfanos_viaje_fallo', { viaje: v.id, err: msg(e) });
        }
      }
      if (ligados.length > 0) {
        try {
          await x.marcarReconciliados(v.tenantId, ligados, v.id, ahora);
          for (const id of ligados) consumidos.add(id);
          r.reconciliados += ligados.length;
        } catch (e) {
          r.fallos.push(`huérfanos (marcar): ${msg(e)}`);
          logger.error('conductor.huerfanos_marcar_fallo', { viaje: v.id, err: msg(e) });
        }
      }
    }
  } catch (e) {
    r.fallos.push(`huérfanos (reconciliar): ${msg(e)}`);
    logger.error('conductor.huerfanos_reconciliar_fallo', { err: msg(e) });
  }
}
