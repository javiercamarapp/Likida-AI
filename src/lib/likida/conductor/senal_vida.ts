import { logger } from '@/lib/logger';
import type { ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import { dentroDeGeocerca, haversineM } from './geo';
import type { MuestraGps, SitioGps, SitiosViaje, UnidadDeViaje } from './ciclo_gps';
import { dentroDeVentana, type ConfigConductor } from './config';
import type { Destino } from './escalamiento';
import type { ViajeContexto } from './repo';
import { armarEscalacionSenalVida, armarSenalVida, type MensajeSaliente, type MotivoSenalVida } from './solicitudes';
import { estaPendiente, estaResuelto, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// «SIN SEÑAL DE VIDA» EN TRÁNSITO (P2, ola 4c).
//
// Un tractor cargado en carretera cuyo GPS se calla —o que lleva rato detenido en medio de la nada— es lo primero que un jefe de
// tráfico quiere saber. El Conductor lo detecta y le pregunta al CHOFER antes de molestar a nadie más:
//
//   aviso 1 al chofer («¿sigues bien?», botones «Sí, estoy» / «Voy a cargar» / «Estoy bien»)
//     → 20 min sin respuesta → aviso 2 → 20 min → aviso al JEFE DE TRÁFICO (patio responsable, con «Ya lo atiendo»).
//
// ── CUÁNDO HAY UN EPISODIO ─────────────────────────────────────────────────
// Solo en TRÁNSITO (salió de la carga y no ha llegado a la descarga), dentro de la ventana horaria de la flota, y solo si la
// flota encendió `avisar_senal_vida` (apagado por omisión: manda mensajes a personas). Dos formas de «sin señal»:
//   · gps_obsoleto  la última muestra de GPS tiene más de 45 min (el poll corre cada 5). Solo si la unidad REPORTA GPS (hubo
//                   alguna muestra en las últimas 24 h): una flota sin conector no tiene «señal que se calló».
//   · gps_detenido  la unidad lleva 60 min dentro de 150 m del mismo punto y NO está en un sitio del viaje (en la planta se
//                   espera: eso lo cubren la estadía y la alerta de llegada).
// Los umbrales son SUPUESTOS (constantes de aquí), no mediciones: se ajustan con datos reales de la flota.
//
// ── UNA RESPUESTA CIERRA, Y NO SE VUELVE A PREGUNTAR AL INSTANTE ────────────
// Si el chofer contesta, el episodio se cierra y se SILENCIA 2 h («Voy a cargar»: 1 h): el GPS seguirá mudo y volver a
// preguntar enseguida sería acoso. Un episodio abierto por viaje como máximo; cada nivel se reclama con UPDATE condicional
// (0636), así que dos corridas solapadas no mandan el mismo aviso dos veces. Si el GPS vuelve, el episodio se cierra solo.
// ═══════════════════════════════════════════════════════════════════════════

export const MINUTOS_GPS_OBSOLETO = 45;
export const MINUTOS_DETENIDO = 60;
export const RADIO_DETENIDO_M = 150;
/** Cobertura mínima del GPS para afirmar «detenido»: debe haber muestras desde el principio de la ventana (± esto). */
export const MINUTOS_COBERTURA_DETENIDO = 15;
export const MINIMO_MUESTRAS_DETENIDO = 3;
export const MINUTOS_SEGUNDO_AVISO = 20;
export const MINUTOS_ESCALAR = 20;
export const MINUTOS_SILENCIO_RESPUESTA = 120;
export const MINUTOS_SILENCIO_CARGAR = 60;
/** Cuántas horas de GPS se leen por pasada (lo suficiente para ver «detenido» y «reciente»). */
export const HORAS_MUESTRAS_SENAL = 2;
/** Cuántas horas atrás cuenta una muestra para decir «esta unidad sí reporta GPS». */
export const HORAS_UNIDAD_CON_GPS = 24;
export const TOPE_VIAJES_SENAL_VIDA = 400;
/** Con la ignición apagada el dispositivo deja de reportar: el silencio es esperable. Pasadas tantas horas ya no se da por «descansando». */
export const MINUTOS_APAGADO_MAXIMO = 12 * 60;
/**
 * Si al menos este número de unidades en tránsito de UNA flota con GPS dejan de reportar a la vez y son al menos esta fracción de ellas,
 * lo que se calló es el CONECTOR (credencial vencida, proveedor caído), no los tractores: no se le pregunta a ningún chofer.
 */
export const MIN_UNIDADES_CONECTOR_CAIDO = 3;
export const FRACCION_CONECTOR_CAIDO = 0.8;
/** Cinco rechazos reintentables seguidos paran la corrida (es Meta diciendo «hoy no»). */
export const TOPE_RECHAZOS_SEGUIDOS_SENAL = 5;

// ── Lo puro ─────────────────────────────────────────────────────────────────

/** ¿El viaje va en tránsito? salió de la carga (registrado) y todavía no llega a la descarga. */
export function enTransito(hitos: readonly HitoFila[]): boolean {
  const sc = hitos.find((h) => h.tipo === 'salida_carga');
  const ld = hitos.find((h) => h.tipo === 'llegada_descarga');
  return Boolean(sc && estaResuelto(sc) && ld && estaPendiente(ld));
}

export type EstadoSenal =
  | { estado: 'ok' }
  | { estado: 'sin_gps' }
  /** Hay silencio, pero es de TODA la flota (conector caído): no es señal de que este tractor esté mal. */
  | { estado: 'conector_caido'; minutos: number }
  | { estado: MotivoSenalVida; minutos: number; ultimaMuestraEn: Date };

export interface EntradaEvaluar {
  /** Muestras de GPS (no pines), en cualquier orden, de las últimas `HORAS_MUESTRAS_SENAL` horas. */
  muestras: readonly MuestraGps[];
  /** La última muestra de GPS de las últimas 24 h, para cuando no hay ninguna en la ventana corta. `null` = nunca reportó. */
  ultimaMuestraEn: Date | null;
  /** Esa última muestra con su posición e ignición (si el puerto la trae): con ella se sabe si el silencio es de una unidad estacionada. */
  ultimaMuestra?: MuestraGps | null;
  sitios: SitiosViaje;
  /** Los demás sitios de la flota (patios, plantas de otros clientes): donde esperar es normal. */
  sitiosFlota?: readonly SitioGps[];
  toleranciaM: number;
  ahora: Date;
}

export function evaluarSenal(e: EntradaEvaluar): EstadoSenal {
  const ordenadas = [...e.muestras].filter((m) => Number.isFinite(m.medidaEn.getTime())).sort((a, b) => a.medidaEn.getTime() - b.medidaEn.getTime());
  const ultima = ordenadas.length > 0 ? ordenadas[ordenadas.length - 1] : null;
  const ultimaEn = ultima?.medidaEn ?? e.ultimaMuestra?.medidaEn ?? e.ultimaMuestraEn;
  if (!ultimaEn) return { estado: 'sin_gps' }; // nunca reportó (o hace más de un día): no hay «señal que se calló»
  const sitiosDeEspera = [e.sitios.origen, e.sitios.destino, ...(e.sitiosFlota ?? [])];
  const enSitioDeEspera = (m: MuestraGps): boolean => sitiosDeEspera.some((s) => s !== null && dentroDeGeocerca(m, s, e.toleranciaM + RADIO_DETENIDO_M).dentro);

  const minutos = Math.floor((e.ahora.getTime() - ultimaEn.getTime()) / 60_000);
  if (minutos > MINUTOS_GPS_OBSOLETO) {
    // Un tractor que llega a la planta y apaga el motor deja UNA muestra dentro (el poller colapsa la misma lectura) y calla: eso no es
    // «sin señal de vida». Ni en un sitio del viaje o de la flota, ni con la ignición apagada (un tope de horas, no para siempre).
    const posicion = ultima ?? e.ultimaMuestra ?? null;
    if (posicion && enSitioDeEspera(posicion)) return { estado: 'ok' };
    if (posicion?.ignicion === false && minutos <= MINUTOS_APAGADO_MAXIMO) return { estado: 'ok' };
    return { estado: 'gps_obsoleto', minutos, ultimaMuestraEn: ultimaEn };
  }
  if (!ultima) return { estado: 'ok' };

  // Detenido: cobertura de toda la ventana, ≥ 3 muestras y todas pegadas a la última, y no en un sitio del viaje.
  const inicio = e.ahora.getTime() - MINUTOS_DETENIDO * 60_000;
  const ventana = ordenadas.filter((m) => m.medidaEn.getTime() >= inicio);
  if (ventana.length < MINIMO_MUESTRAS_DETENIDO) return { estado: 'ok' };
  if (ventana[0].medidaEn.getTime() > inicio + MINUTOS_COBERTURA_DETENIDO * 60_000) return { estado: 'ok' };
  if (!ventana.every((m) => haversineM(m, ultima) <= RADIO_DETENIDO_M)) return { estado: 'ok' };
  if (enSitioDeEspera(ultima)) return { estado: 'ok' };
  return { estado: 'gps_detenido', minutos: Math.floor((e.ahora.getTime() - ventana[0].medidaEn.getTime()) / 60_000), ultimaMuestraEn: ultima.medidaEn };
}

export interface EpisodioFila {
  id: string;
  tenantId: string;
  viajeId: string;
  motivo: MotivoSenalVida;
  abiertoEn: string;
  nivelEnviado: 0 | 1 | 2 | 3;
  aviso1En: string | null;
  aviso2En: string | null;
  escaladoEn: string | null;
  /** Último error anotado en el episodio (lleva la marca de los avisos al chofer que fallaron: `avisosFallidosAlChofer`). */
  ultimoError?: string | null;
}

const MARCA_AVISO_FALLIDO = 'aviso_chofer_fallido:';

/** Cuántos de los avisos 1 y 2 NO le llegaron al chofer por un rechazo definitivo (ventana de 24 h cerrada, plantilla sin aprobar, teléfono inválido). */
export function avisosFallidosAlChofer(ultimoError: string | null | undefined): number {
  if (!ultimoError?.startsWith(MARCA_AVISO_FALLIDO)) return 0;
  const niveles = ultimoError.slice(MARCA_AVISO_FALLIDO.length).split('|')[0].split(',').filter((n) => n === '1' || n === '2');
  return new Set(niveles).size;
}

/** El texto de `ultimo_error` tras un rechazo definitivo del aviso `nivel` al chofer: conserva la marca del nivel anterior. */
export function marcaAvisoChoferFallido(previo: string | null | undefined, nivel: 1 | 2, mensaje: string): string {
  const antes = previo?.startsWith(MARCA_AVISO_FALLIDO) ? previo.slice(MARCA_AVISO_FALLIDO.length).split('|')[0].split(',').filter((n) => n === '1' || n === '2') : [];
  const niveles = [...new Set([...antes, String(nivel)])].sort().join(',');
  return `${MARCA_AVISO_FALLIDO}${niveles}|${mensaje}`.slice(0, 200);
}

export interface EstadoEpisodios {
  abierto: EpisodioFila | null;
  /** El silencio que dejó el último episodio cerrado (la respuesta del chofer). */
  silenciadoHasta: Date | null;
}

export type MotivoNadaSenal =
  | 'flota_apagada' | 'no_transito' | 'sin_gps' | 'conector_caido' | 'ok' | 'fuera_de_ventana' | 'silenciado' | 'sin_telefono' | 'espera' | 'ya_escalado';

export type AccionSenal =
  | { tipo: 'nada'; motivo: MotivoNadaSenal }
  | { tipo: 'abrir'; motivo: MotivoSenalVida; minutos: number }
  | { tipo: 'avisar'; nivel: 1 | 2; minutos: number }
  | { tipo: 'escalar'; minutos: number }
  | { tipo: 'cerrar'; motivo: 'senal_recuperada' | 'viaje_cerrado' };

export interface EntradaDecidirSenal {
  viaje: Pick<ViajeContexto, 'operadorTelefono'>;
  hitos: readonly HitoFila[];
  config: Pick<ConfigConductor, 'activo' | 'avisarSenalVida' | 'horaInicio' | 'horaFin' | 'diasSemana'>;
  senal: EstadoSenal;
  episodios: EstadoEpisodios;
  ahora: Date;
}

const min = (iso: string | null, ahora: Date): number | null => (iso ? (ahora.getTime() - new Date(iso).getTime()) / 60_000 : null);

/** Qué hacer con el episodio de este viaje ahora. Pura y determinista. */
export function decidirSenalVida(e: EntradaDecidirSenal): AccionSenal {
  const { config, ahora } = e;
  const ep = e.episodios.abierto;
  if (!config.activo || !config.avisarSenalVida) return { tipo: 'nada', motivo: 'flota_apagada' };

  // Un episodio abierto de un viaje que ya no va en tránsito o cuyo GPS ya vuelve a reportar se cierra solo.
  if (ep) {
    if (!enTransito(e.hitos)) return { tipo: 'cerrar', motivo: 'viaje_cerrado' };
    if (e.senal.estado === 'ok') return { tipo: 'cerrar', motivo: 'senal_recuperada' };
  }
  if (!enTransito(e.hitos)) return { tipo: 'nada', motivo: 'no_transito' };
  if (e.senal.estado === 'conector_caido') return { tipo: 'nada', motivo: 'conector_caido' }; // ni se abre, ni se avanza, ni se cierra: el silencio no es de este tractor
  if (e.senal.estado === 'sin_gps') return { tipo: 'nada', motivo: 'sin_gps' };
  if (e.senal.estado === 'ok') return { tipo: 'nada', motivo: 'ok' };
  if (!dentroDeVentana(config, ahora)) return { tipo: 'nada', motivo: 'fuera_de_ventana' };
  const minutos = e.senal.minutos;

  if (!ep) {
    if (e.episodios.silenciadoHasta && e.episodios.silenciadoHasta.getTime() > ahora.getTime()) return { tipo: 'nada', motivo: 'silenciado' };
    if (!e.viaje.operadorTelefono) return { tipo: 'nada', motivo: 'sin_telefono' };
    return { tipo: 'abrir', motivo: e.senal.estado, minutos };
  }
  if (ep.nivelEnviado === 0) return { tipo: 'avisar', nivel: 1, minutos };
  if (ep.nivelEnviado === 1) {
    const t = min(ep.aviso1En, ahora);
    return t !== null && t >= MINUTOS_SEGUNDO_AVISO ? { tipo: 'avisar', nivel: 2, minutos } : { tipo: 'nada', motivo: 'espera' };
  }
  if (ep.nivelEnviado === 2) {
    const t = min(ep.aviso2En, ahora);
    return t !== null && t >= MINUTOS_ESCALAR ? { tipo: 'escalar', minutos } : { tipo: 'nada', motivo: 'espera' };
  }
  return { tipo: 'nada', motivo: 'ya_escalado' };
}

/** Cuántos minutos de silencio deja cada respuesta del chofer. */
export function silencioDeRespuesta(r: 'estoy' | 'voy_a_cargar' | 'estoy_bien'): number {
  return r === 'voy_a_cargar' ? MINUTOS_SILENCIO_CARGAR : MINUTOS_SILENCIO_RESPUESTA;
}

// ── El barrido (con puertos) ────────────────────────────────────────────────

export interface PuertosSenalVida {
  viajes(limite: number): Promise<ViajeContexto[]>;
  hitosDe(viajeIds: string[]): Promise<HitoFila[]>;
  configDe(tenantId: string): Promise<ConfigConductor>;
  sitiosDe(viajes: ViajeContexto[]): Promise<Map<string, SitiosViaje>>;
  muestras(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, MuestraGps[]>>;
  /** La última muestra de GPS de verdad de cada unidad desde `desde`, con posición e ignición. */
  ultimaMuestra(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, MuestraGps>>;
  /** Los sitios de la flota (patios y demás) donde esperar es normal. Opcional: sin él solo cuentan el origen y el destino del viaje. */
  sitiosFlota?(tenantIds: string[]): Promise<Map<string, SitioGps[]>>;
  /** Las flotas cuyo conector de GPS tiene la última lectura fallida (credencial vencida, proveedor caído). Opcional. */
  conectoresDegradados?(tenantIds: string[]): Promise<Set<string>>;
  episodios(viajeIds: string[], ahora: Date): Promise<Map<string, EstadoEpisodios>>;
  /** Abre el episodio (único abierto por viaje). `null` = otra corrida lo abrió primero, o no se pudo. */
  abrir(tenantId: string, viajeId: string, motivo: MotivoSenalVida, ahora: Date): Promise<EpisodioFila | null>;
  /** Reclama el nivel k (UPDATE condicional `nivel_enviado = k-1`). */
  reclamarNivel(ep: EpisodioFila, nivel: 1 | 2 | 3, ahora: Date): Promise<'ganado' | 'perdido' | 'fallo'>;
  cerrar(ep: EpisodioFila, motivo: 'senal_recuperada' | 'viaje_cerrado', ahora: Date): Promise<void>;
  anotarFallo(ep: EpisodioFila, texto: string): Promise<void>;
  enviar(telefono: string, m: MensajeSaliente, contexto: string, tenantId: string, ahora: Date): Promise<ResultadoEnvioConFallback>;
  destinatarios(tenantId: string, terminalId: string | null, nivel: 1 | 2): Promise<Destino[]>;
  ubicacion(v: ViajeContexto, hs: readonly HitoFila[], ahora: Date): Promise<string>;
}

export interface ResultadoSenalVida {
  viajes: number;
  enTransito: number;
  abiertos: number;
  avisosChofer: number;
  escalaciones: number;
  cerrados: number;
  yaReclamados: number;
  sinDestinatario: number;
  rechazosReintentables: number;
  cortadaPorRechazoMasivo: boolean;
  cortadosPorReloj: number;
  fallos: string[];
  saltados: Partial<Record<MotivoNadaSenal, number>>;
}

const llave = (v: Pick<ViajeContexto, 'tenantId' | 'unidadId'>): string => `${v.tenantId}|${v.unidadId}`;

export async function barridoSenalVida(p: PuertosSenalVida, ahora: Date = new Date(), venceEn?: number): Promise<ResultadoSenalVida> {
  const r: ResultadoSenalVida = {
    viajes: 0, enTransito: 0, abiertos: 0, avisosChofer: 0, escalaciones: 0, cerrados: 0, yaReclamados: 0, sinDestinatario: 0,
    rechazosReintentables: 0, cortadaPorRechazoMasivo: false, cortadosPorReloj: 0, fallos: [], saltados: {},
  };
  const salta = (m: MotivoNadaSenal) => { r.saltados[m] = (r.saltados[m] ?? 0) + 1; };

  const viajes = await p.viajes(TOPE_VIAJES_SENAL_VIDA);
  r.viajes = viajes.length;
  if (viajes.length === 0) return r;
  const configs = new Map<string, ConfigConductor | null>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try { configs.set(t, await p.configDe(t)); } catch (e) {
      configs.set(t, null);
      logger.error('conductor.senal_vida_config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }
  const aptos = viajes.filter((v) => { const c = configs.get(v.tenantId); return Boolean(c && c.activo && c.avisarSenalVida && v.unidadId); });
  if (aptos.length === 0) return r;

  const hitos = await p.hitosDe(aptos.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);
  const episodios = await p.episodios(aptos.map((v) => v.id), ahora);

  // Se evalúan los que van en tránsito y los que tienen un episodio abierto (para cerrarlo).
  const aEvaluar = aptos.filter((v) => enTransito(porViaje.get(v.id) ?? []) || episodios.get(v.id)?.abierto);
  r.enTransito = aEvaluar.length;
  if (aEvaluar.length === 0) return r;

  const unidades = [...new Map(aEvaluar.map((v) => [llave(v), { tenantId: v.tenantId, unidadId: v.unidadId! }])).values()];
  const muestras = await p.muestras(unidades, new Date(ahora.getTime() - HORAS_MUESTRAS_SENAL * 3_600_000));
  const sinMuestras = unidades.filter((u) => !(muestras.get(`${u.tenantId}|${u.unidadId}`)?.length));
  const ultimas = sinMuestras.length > 0 ? await p.ultimaMuestra(sinMuestras, new Date(ahora.getTime() - HORAS_UNIDAD_CON_GPS * 3_600_000)) : new Map<string, MuestraGps>();
  const sitios = await p.sitiosDe(aEvaluar);
  const tenantsEvaluados = [...new Set(aEvaluar.map((v) => v.tenantId))];
  // Los sitios de la flota y el estado del conector son un APOYO: si no se pueden leer, se evalúa sin ellos (y se dice), no se tumba el barrido.
  let sitiosFlota = new Map<string, SitioGps[]>();
  let conectoresDegradados = new Set<string>();
  try { if (p.sitiosFlota) sitiosFlota = await p.sitiosFlota(tenantsEvaluados); } catch (e) {
    r.fallos.push(`sitios de la flota: ${e instanceof Error ? e.message : 'error'}`);
    logger.error('conductor.senal_vida_sitios_flota_fallo', { err: e instanceof Error ? e.message : String(e) });
  }
  try { if (p.conectoresDegradados) conectoresDegradados = await p.conectoresDegradados(tenantsEvaluados); } catch (e) {
    r.fallos.push(`estado del conector GPS: ${e instanceof Error ? e.message : 'error'}`);
    logger.error('conductor.senal_vida_conector_fallo', { err: e instanceof Error ? e.message : String(e) });
  }

  // Primero la señal de TODOS: así se distingue «este tractor se calló» de «se calló el conector de toda la flota».
  const senales = new Map<string, EstadoSenal>();
  for (const v of aEvaluar) {
    const ultima = ultimas.get(llave(v)) ?? null;
    senales.set(v.id, evaluarSenal({
      muestras: muestras.get(llave(v)) ?? [], ultimaMuestraEn: ultima?.medidaEn ?? null, ultimaMuestra: ultima,
      sitios: sitios.get(v.id) ?? { origen: null, destino: null }, sitiosFlota: sitiosFlota.get(v.tenantId) ?? [],
      toleranciaM: configs.get(v.tenantId)!.toleranciaUbicacionM, ahora,
    }));
  }
  const conectorCaido = new Set<string>();
  for (const t of tenantsEvaluados) {
    const delTenant = aEvaluar.filter((v) => v.tenantId === t);
    const unidadesConGps = new Set(delTenant.filter((v) => senales.get(v.id)!.estado !== 'sin_gps').map((v) => v.unidadId));
    const unidadesObsoletas = new Set(delTenant.filter((v) => senales.get(v.id)!.estado === 'gps_obsoleto').map((v) => v.unidadId));
    const masivo = unidadesConGps.size >= MIN_UNIDADES_CONECTOR_CAIDO && unidadesObsoletas.size / unidadesConGps.size >= FRACCION_CONECTOR_CAIDO;
    if (unidadesObsoletas.size > 0 && (masivo || conectoresDegradados.has(t))) conectorCaido.add(t);
  }

  let rechazosSeguidos = 0;
  for (const [i, v] of aEvaluar.entries()) {
    if (venceEn !== undefined && Date.now() >= venceEn) { r.cortadosPorReloj = aEvaluar.length - i; break; }
    const config = configs.get(v.tenantId)!;
    const hs = porViaje.get(v.id) ?? [];
    let senal = senales.get(v.id)!;
    if (senal.estado === 'gps_obsoleto' && conectorCaido.has(v.tenantId)) senal = { estado: 'conector_caido', minutos: senal.minutos };
    const estado = episodios.get(v.id) ?? { abierto: null, silenciadoHasta: null };
    const accion = decidirSenalVida({ viaje: v, hitos: hs, config, senal, episodios: estado, ahora });
    if (accion.tipo === 'nada') { salta(accion.motivo); continue; }

    try {
      if (accion.tipo === 'cerrar') {
        await p.cerrar(estado.abierto!, accion.motivo, ahora);
        r.cerrados++;
        continue;
      }
      let ep = estado.abierto;
      if (accion.tipo === 'abrir') {
        ep = await p.abrir(v.tenantId, v.id, accion.motivo, ahora);
        if (!ep) { r.yaReclamados++; continue; }
        r.abiertos++;
      }
      const motivo = ep!.motivo;
      const nivel: 1 | 2 | 3 = accion.tipo === 'escalar' ? 3 : accion.tipo === 'avisar' ? accion.nivel : 1;
      const gano = await p.reclamarNivel(ep!, nivel, ahora);
      if (gano === 'perdido') { r.yaReclamados++; continue; }
      if (gano === 'fallo') { r.fallos.push(`reclamo ${v.folio ?? v.id}`); continue; }

      if (nivel === 3) {
        const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
        if (destinos.length === 0) {
          r.sinDestinatario++;
          r.fallos.push(`${v.folio ?? v.id}: no hay a quién escalar la señal de vida`);
          await p.anotarFallo(ep!, 'sin_destinatario');
          continue;
        }
        // Lo que se le dice al jefe es lo que PASÓ: si un aviso al chofer fue rechazado, «se le avisó dos veces» sería falso.
        const avisosEntregados = (2 - Math.min(2, avisosFallidosAlChofer(ep!.ultimoError))) as 0 | 1 | 2;
        const msg = armarEscalacionSenalVida(v, motivo, accion.minutos, await p.ubicacion(v, hs, ahora), avisosEntregados);
        let entregados = 0; let reintentables = 0; let ultimoError = '';
        for (const d of destinos) {
          const envio = await p.enviar(d.telefono, msg, 'conductor.senal_vida_jefe', v.tenantId, ahora);
          if (envio.ok) entregados++;
          else { ultimoError = envio.mensaje; if (envio.reintentable || envio.encolado) reintentables++; }
        }
        if (entregados > 0) { r.escalaciones++; rechazosSeguidos = 0; }
        else if (reintentables === destinos.length) {
          // Ya está en `wa_outbox`: el nivel quedó reclamado y no se reenvía.
          r.rechazosReintentables++; rechazosSeguidos++;
          r.fallos.push(`escalación señal de vida ${v.folio ?? v.id}: ${ultimoError} (queda en la cola de WhatsApp; no se reenvía)`);
        } else {
          await p.anotarFallo(ep!, ultimoError.slice(0, 200));
          r.fallos.push(`escalación señal de vida ${v.folio ?? v.id}: ${ultimoError}`);
        }
      } else {
        const msg = armarSenalVida(v, nivel, motivo, accion.minutos);
        const envio = await p.enviar(v.operadorTelefono!, msg, `conductor.senal_vida_n${nivel}`, v.tenantId, ahora);
        if (envio.ok) { r.avisosChofer++; rechazosSeguidos = 0; }
        else if (envio.reintentable || envio.encolado) {
          // Ya está en `wa_outbox`: el nivel quedó reclamado (la escalera sigue) y el outbox lo entrega.
          r.rechazosReintentables++; rechazosSeguidos++;
          r.fallos.push(`señal de vida ${v.folio ?? v.id}: ${envio.mensaje} (queda en la cola de WhatsApp; no se reenvía)`);
        } else {
          // La escalera avanza al siguiente nivel en vez de repetir el fallo, pero deja constancia de que ESTE aviso no llegó.
          const marca = marcaAvisoChoferFallido(ep!.ultimoError, nivel as 1 | 2, envio.mensaje);
          await p.anotarFallo(ep!, marca);
          ep!.ultimoError = marca;
          r.fallos.push(`señal de vida ${v.folio ?? v.id}: ${envio.mensaje}`);
        }
      }
    } catch (e) {
      r.fallos.push(`${v.folio ?? v.id}: ${e instanceof Error ? e.message : 'error inesperado'}`);
      logger.error('conductor.senal_vida_viaje_fallo', { viaje: v.id, err: e instanceof Error ? e.message : String(e) });
    }
    if (rechazosSeguidos >= TOPE_RECHAZOS_SEGUIDOS_SENAL) {
      r.cortadaPorRechazoMasivo = true;
      r.cortadosPorReloj = aEvaluar.length - i - 1;
      logger.error('conductor.senal_vida_rechazo_masivo', { rechazosSeguidos });
      break;
    }
  }
  logger.info('conductor.senal_vida', { viajes: r.viajes, enTransito: r.enTransito, abiertos: r.abiertos, avisos: r.avisosChofer, escalaciones: r.escalaciones, fallos: r.fallos.length });
  return r;
}
