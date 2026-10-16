import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import { parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import type { MuestraGps, SitiosViaje, UnidadDeViaje } from './ciclo_gps';
import {
  clavesPoleoDe, detencionElegible, lapsoMaxCompuertaMin, POLEO_CONSERVADOR_MIN, puedeEscribirAlChofer,
  type RazonDetencion, type ResultadoCompuerta,
} from './compuerta_movimiento';
import { CONFIG_CONDUCTOR_DEFAULT, dentroDeVentana, type ConfigConductor } from './config';
import { puertosReales, type NuevoAviso, type PuertosConductor } from './ejecutor';
import { combinarSenal, leerSenalesDeUnidades } from './senales_conduccion';
import { horaYDiaMx, type BotonSalida, type Salida } from './mensajes';
import {
  ejecutarParada, ETIQUETA_MOTIVO, MOTIVOS_PARADA, PREFIJO_PARADA, type DepsParada, type OrdenParada,
} from './paradas';
import { textoTiempo } from './planificador';
import {
  guardarEventoDetencion, leerEventosDetencion, leerParadasRecientes, type EventoDetencionFila, type ViajeContexto,
} from './repo';
import { enTransito } from './senal_vida';
import type { MensajeSaliente } from './solicitudes';
import type { HitoFila } from './tipos';
import type { ParadaFila } from './paradas';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-39 — DETENCIÓN SIN AVISO: LA PREGUNTA AL CHOFER (plantilla N05).
//
// Requisito del cliente (R10): si el operador no avisa y el GPS lo ve detenido, la IA pregunta «¿todo bien? ¿motivo?». La política del
// cliente (R09) es no escribirle en marcha, así que solo se pregunta con la unidad detenida, y UNA vez por episodio: el exceso de
// mensajes se vive como vigilancia (un chofer golpeó la cámara de cabina) y no se insiste ni se repite.
//
// Quién invoca qué (todo apagado por omisión: `config.deteccionParadaActiva`, y el módulo A5 va «Próximamente» en el perfil de fase 1):
//   · PREGUNTA   → `correrDeteccionParada`, desde el cron `/api/cron/conductor-hitos` (aislado como las demás pasadas).
//   · RESPUESTAS → `responderDetencion` (botones de N05) y `responderParada` (parada que inicia el chofer, T-A5-38), desde `atenderConductor`.
//
// Las tres respuestas de N05:
//   «Todo bien»        → se anota y el episodio queda contestado: NO crea parada y NO se vuelve a preguntar en él.
//   «Registrar motivo» → se le abre la lista de motivos (la de T-A5-38, en páginas de tres botones: WhatsApp no da más); el motivo
//                        elegido CREA la parada (`viaje_parada`) con el mismo flujo de siempre.
//   «Necesito apoyo»   → avisa al supervisor/destinatario configurado (D-4: configurable; el audio solo oyó «supervisor»).
// Sin respuesta NO se escala por sí sola; es una opción de configuración (`detencionEscalaSinRespuestaMin`, apagada por omisión).
// El texto de N05 NO pide ni cita la clave de amago ni evidencias: la propuesta de cortesía las incluía y el cliente dijo que no van por
// WhatsApp (la propuesta fue de operaciones; monitoreo y coordinación la rechazaron).
//
// ── EPISODIO (Ruling: sin migración) ────────────────────────────────────────
// Un episodio es una detención continua. Se abre al preguntar y se CIERRA cuando una pasada ve la unidad en movimiento (o dentro de un
// sitio del viaje) o el viaje deja de ir en tránsito; mientras siga abierto no se pregunta otra vez, aunque el chofer haya contestado
// «Todo bien» o no haya contestado. Vive en la bitácora `viaje_hito_evento` (clase `deteccion_parada`, sin datos personales ni
// coordenadas): `pregunta`, `respuesta`, `apoyo`, `escalada`, `cierre`. Una parada abierta (incl. «pernocta») o recién cerrada por el chofer
// tampoco dispara la pregunta. Costo si me equivoco: una unidad que se mueve y se vuelve a parar entre dos pasadas del cron (5 min) cuenta
// como el mismo episodio: una pregunta de menos, nunca de más.
// CLAIM: el claim atómico de la pregunta es `viaje_hito_aviso` (clase `escalacion`, nivel 3) sobre el hito ancla con `ciclo` = 100 + n.º de
// episodio (los ciclos reales de un hito son pocos: así no se cruza con el planificador, que lee por (hito, ciclo)).
// ═══════════════════════════════════════════════════════════════════════════

export const CLASE_DETENCION = 'deteccion_parada';
/** Nivel del claim `escalacion` de la pregunta (los niveles 0–2 son del ciclo; el 3–5 del reporte de llegada se ancla a las llegadas). */
export const NIVEL_PREGUNTA_DETENCION = 3;
/** El ciclo del claim es `CICLO_BASE_CLAIM_DETENCION + n.º de episodio`: un episodio = un claim. */
export const CICLO_BASE_CLAIM_DETENCION = 100;

const una = (t: string, n: number): string => t.replace(/\s+/g, ' ').trim().slice(0, n);
const primerNombre = (n: string | null): string => una(n ?? 'chofer', 40).split(' ')[0] || 'chofer';

// ── Los botones de N05 y la página de motivos ───────────────────────────────

export type OpcionDetencion = 'ok' | 'motivo' | 'apoyo';
export const PREFIJO_DETENCION: Readonly<Record<OpcionDetencion, string>> = { ok: 'parada_ok', motivo: 'parada_motivo', apoyo: 'parada_apoyo' };
/** Botón «Más opciones» de la lista de motivos: `parada_mas<página>:<viaje>`. */
export const PREFIJO_PAGINA_MOTIVOS = 'parada_mas';

export type BotonDetencion =
  | { accion: 'opcion'; opcion: OpcionDetencion; viajeId: string }
  | { accion: 'pagina'; pagina: 1 | 2; viajeId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿El texto es el payload de un botón de N05 o de la página de motivos? Anclado, con el uuid validado. */
export function leerBotonDetencion(texto: string | undefined): BotonDetencion | null {
  if (typeof texto !== 'string') return null;
  const t = texto.trim();
  if (t.length > 128) return null;
  const partes = t.split(':');
  if (partes.length !== 2 || !UUID.test(partes[1])) return null;
  const viajeId = partes[1].toLowerCase();
  for (const opcion of ['ok', 'motivo', 'apoyo'] as const) {
    if (partes[0] === PREFIJO_DETENCION[opcion]) return { accion: 'opcion', opcion, viajeId };
  }
  if (partes[0] === `${PREFIJO_PAGINA_MOTIVOS}1`) return { accion: 'pagina', pagina: 1, viajeId };
  if (partes[0] === `${PREFIJO_PAGINA_MOTIVOS}2`) return { accion: 'pagina', pagina: 2, viajeId };
  return null;
}

/**
 * La lista de motivos de T-A5-38 en PÁGINAS DE TRES BOTONES (el processor manda botones de respuesta, no listas): dos motivos y «Más
 * opciones», y la última página los dos que quedan. Los ids de los motivos son los de `paradas.ts` (`parada_motivo_<motivo>:<viaje>`).
 */
export function salidaMotivos(viajeId: string, pagina: 0 | 1 | 2 = 0): Salida {
  const porPagina = 2;
  const motivos = MOTIVOS_PARADA.slice(pagina * porPagina, pagina * porPagina + porPagina);
  const botones: BotonSalida[] = motivos.map((m) => ({ id: `${PREFIJO_PARADA.motivo}${m}:${viajeId}`, titulo: ETIQUETA_MOTIVO[m] }));
  if (pagina < 2) botones.push({ id: `${PREFIJO_PAGINA_MOTIVOS}${pagina + 1}:${viajeId}`, titulo: 'Más opciones' });
  return { texto: pagina === 0 ? 'Anotado. ¿Cuál es el motivo de la parada? Toca una opción.' : 'Estas son las otras opciones. Toca una.', botones };
}

// ── El episodio, leído de la bitácora ────────────────────────────────────────

export interface EstadoDetencion {
  /** Hay un episodio abierto: se preguntó y la unidad no ha vuelto a moverse. */
  abierto: boolean;
  /** Preguntas hechas en toda la historia del viaje (el siguiente claim usa `preguntas + 1`). */
  preguntas: number;
  preguntadoEn: string | null;
  respuesta: OpcionDetencion | null;
  /** Al supervisor ya le llegó el aviso de apoyo de este episodio. */
  apoyoAvisado: boolean;
  /** Ya se avisó al supervisor por falta de respuesta en este episodio. */
  escalada: boolean;
}

const esOpcion = (v: unknown): v is OpcionDetencion => v === 'ok' || v === 'motivo' || v === 'apoyo';

/** Reconstruye el episodio de UN viaje a partir de su bitácora, en el orden en que se escribió. Pura. */
export function estadoDetencionDeEventos(eventos: readonly EventoDetencionFila[], viajeId: string): EstadoDetencion {
  const st: EstadoDetencion = { abierto: false, preguntas: 0, preguntadoEn: null, respuesta: null, apoyoAvisado: false, escalada: false };
  for (const ev of eventos) {
    if (ev.viajeId !== viajeId || ev.detalle.clase !== CLASE_DETENCION) continue;
    const d = ev.detalle;
    if (d.tipo === 'pregunta') {
      st.abierto = true; st.preguntas += 1; st.preguntadoEn = new Date(ev.creadoEn).toISOString();
      st.respuesta = null; st.apoyoAvisado = false; st.escalada = false;
    } else if (d.tipo === 'respuesta' && esOpcion(d.opcion)) {
      st.respuesta = d.opcion;
    } else if (d.tipo === 'apoyo' && d.entregado === true) {
      st.apoyoAvisado = true;
    } else if (d.tipo === 'escalada') {
      st.escalada = true;
    } else if (d.tipo === 'cierre') {
      st.abierto = false;
    }
  }
  return st;
}

// ── La decisión (pura) ──────────────────────────────────────────────────────

export type MotivoNadaDetencion =
  | 'flota_apagada' | 'no_transito' | 'parada_abierta' | 'parada_reciente' | 'no_elegible' | 'episodio_abierto'
  | 'fuera_de_ventana' | 'sin_telefono' | 'compuerta_movimiento';

export type AccionDetencion =
  | { accion: 'nada'; razon: MotivoNadaDetencion }
  | { accion: 'preguntar'; ordinal: number }
  | { accion: 'cerrar'; motivo: 'movimiento' | 'viaje' }
  | { accion: 'escalar' };

export interface EntradaDecidirDetencion {
  activo: boolean;
  enTransito: boolean;
  paradaAbierta: boolean;
  /** El chofer cerró una parada hace menos de `detenidoAvisoMin`: el GPS aún puede verlo quieto sin que lo esté. */
  paradaReciente: boolean;
  estado: EstadoDetencion;
  elegibilidad: { elegible: boolean; razon: RazonDetencion };
  compuerta: ResultadoCompuerta;
  dentroDeVentana: boolean;
  tieneTelefono: boolean;
  /** Minutos tras la pregunta sin respuesta para avisar al supervisor; `undefined` = apagada (por omisión). */
  escalaSinRespuestaMin?: number;
  ahora: Date;
}

const RAZONES_QUE_CIERRAN: readonly RazonDetencion[] = ['en_movimiento', 'conduciendo', 'dentro_del_sitio'];

/** Qué hacer con este viaje ahora. Pura y determinista; falla cerrado (ante la duda, NO pregunta). */
export function decidirDetencion(e: EntradaDecidirDetencion): AccionDetencion {
  if (!e.activo) return { accion: 'nada', razon: 'flota_apagada' };
  if (!e.enTransito) return e.estado.abierto ? { accion: 'cerrar', motivo: 'viaje' } : { accion: 'nada', razon: 'no_transito' };
  // Una parada del chofer (incl. «pernocta») ya es el aviso: no se pregunta ni se escala por una detención que él explicó.
  if (e.paradaAbierta) return { accion: 'nada', razon: 'parada_abierta' };
  if (!e.elegibilidad.elegible) {
    if (e.estado.abierto && RAZONES_QUE_CIERRAN.includes(e.elegibilidad.razon)) return { accion: 'cerrar', motivo: 'movimiento' };
    return { accion: 'nada', razon: 'no_elegible' };
  }
  if (e.estado.abierto) {
    const espera = e.escalaSinRespuestaMin;
    if (espera !== undefined && e.estado.respuesta === null && !e.estado.escalada && e.estado.preguntadoEn
      && (e.ahora.getTime() - Date.parse(e.estado.preguntadoEn)) / 60_000 >= espera && e.dentroDeVentana) return { accion: 'escalar' };
    return { accion: 'nada', razon: 'episodio_abierto' };
  }
  if (e.paradaReciente) return { accion: 'nada', razon: 'parada_reciente' };
  if (!e.dentroDeVentana) return { accion: 'nada', razon: 'fuera_de_ventana' };
  if (!e.tieneTelefono) return { accion: 'nada', razon: 'sin_telefono' };
  if (!e.compuerta.permitido) return { accion: 'nada', razon: 'compuerta_movimiento' };
  return { accion: 'preguntar', ordinal: e.estado.preguntas + 1 };
}

// ── Los mensajes ────────────────────────────────────────────────────────────

export const TEXTO_DETENCION_NO_VIGENTE = 'Ese aviso ya no está vigente. 👍';
export const TEXTO_DETENCION_OK = 'Qué bueno, gracias por avisar. Sigue tu camino con calma. 👍';
export const TEXTO_DETENCION_FALLO = 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏';
export const TEXTO_APOYO_AVISADO = 'Listo, ya le avisé a tu supervisor para que te contacte. 🙏';
export const TEXTO_APOYO_YA_AVISADO = 'Ya le avisé a tu supervisor; te va a contactar. 🙏';
export const TEXTO_APOYO_SIN_AVISO = 'No pude avisarle a tu supervisor por WhatsApp ahorita. Si es urgente, márcale directo. 🙏';

/** La pregunta N05: texto con tres botones y, de respaldo, la plantilla `conductor_detencion_sin_aviso_v1`. Nunca pide clave ni evidencias. */
export function armarPreguntaDetencion(v: ViajeContexto, minutos: number): MensajeSaliente {
  const nombre = primerNombre(v.operadorNombre);
  const folio = v.folio || v.id.slice(0, 8);
  const min = Math.max(1, Math.round(minutos));
  return {
    texto: `Hola ${nombre}, tu unidad del viaje ${folio} lleva ${min} minutos detenida y no registramos una parada. ¿Todo bien? Elige una opción.`,
    botones: [
      { id: `${PREFIJO_DETENCION.ok}:${v.id}`, titulo: 'Todo bien' },
      { id: `${PREFIJO_DETENCION.motivo}:${v.id}`, titulo: 'Registrar motivo' },
      { id: `${PREFIJO_DETENCION.apoyo}:${v.id}`, titulo: 'Necesito apoyo' },
    ],
    plantilla: {
      nombre: 'conductor_detencion_sin_aviso_v1',
      ...opcionesDeEnvio('conductor_detencion_sin_aviso_v1', { cuerpo: [nombre, folio, String(min)], idsBotones: v.id }),
    },
  };
}

/** El aviso al supervisor: texto y, de respaldo, la plantilla genérica de operación (misma que las estadías). */
export function armarAvisoDetencion(v: ViajeContexto, motivo: 'apoyo' | 'sin_respuesta', minutos: number, ahora: Date, zona?: string): MensajeSaliente {
  const chofer = una(v.operadorNombre ?? 'El chofer', 60) || 'El chofer';
  const folio = v.folio || v.id.slice(0, 8);
  const duracion = textoTiempo(minutos);
  const hora = horaYDiaMx(ahora, ahora, zona);
  const texto = motivo === 'apoyo'
    ? `Apoyo solicitado: ${chofer} tocó «Necesito apoyo» con la unidad detenida (viaje ${folio}, ${hora}). Llámale de inmediato; está en el tablero.`
    : `Detención sin respuesta: la unidad de ${chofer} (viaje ${folio}) lleva ${duracion} detenida sin parada registrada y no contestó si todo está bien. Llámale; está en el tablero.`;
  const resumen = motivo === 'apoyo' ? `pidió apoyo, unidad detenida (${folio})` : `sin respuesta, ${duracion} detenida (${folio})`;
  return {
    texto, botones: [],
    plantilla: { nombre: 'aviso_operacion_v1', ...opcionesDeEnvio('aviso_operacion_v1', { cuerpo: parametrosAvisoOficina(chofer, resumen, `${appUrl()}/dashboard/agentes/conductores`) }) },
  };
}

/** El hito donde cuelga la bitácora y el claim del viaje: el de la salida de carga si existe, si no el primero. */
export function hitoAncla(hitos: readonly HitoFila[]): HitoFila | null {
  return hitos.find((h) => h.tipo === 'salida_carga') ?? hitos[0] ?? null;
}

// ── El aviso al supervisor (lo comparten el cron y el botón «Necesito apoyo») ─

type PuertosAviso = Pick<PuertosConductor, 'destinatarios' | 'enviar'>;

async function avisarSupervisor(
  p: PuertosAviso, v: ViajeContexto, msg: MensajeSaliente, contexto: string, ahora: Date,
): Promise<'entregado' | 'en_cola' | 'sin_destinatario' | 'fallo'> {
  const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
  if (destinos.length === 0) return 'sin_destinatario';
  let entregados = 0;
  let reintentables = 0;
  for (const d of destinos) {
    const envio = await p.enviar(d.telefono, msg, contexto, v.tenantId, ahora);
    if (envio.ok) entregados++;
    else if (envio.reintentable || envio.encolado) reintentables++;
  }
  if (entregados > 0) return 'entregado';
  // Un rechazo reintentable YA quedó en `wa_outbox`, que lo entrega solo: se da por avisado (reenviarlo lo duplicaría).
  return reintentables === destinos.length ? 'en_cola' : 'fallo';
}

// ── El cron: la pregunta proactiva ───────────────────────────────────────────

export interface PuertosDetencion extends Pick<PuertosConductor, 'viajesActivos' | 'hitosDe' | 'configDe' | 'reclamar' | 'cerrarAviso' | 'liberarAviso' | 'enviar' | 'destinatarios' | 'muestrasUnidad' | 'sitiosDe' | 'senalesConduccion'> {
  eventosDetencion(tenantId: string, viajeIds: string[]): Promise<EventoDetencionFila[]>;
  guardarEventoDetencion(h: HitoFila, detalle: Record<string, string | number | boolean | null>): Promise<boolean>;
  paradasRecientes(tenantId: string, viajeIds: string[], desde: Date): Promise<ParadaFila[]>;
}

export function puertosDetencionReales(): PuertosDetencion {
  return { ...puertosReales(), eventosDetencion: leerEventosDetencion, guardarEventoDetencion, paradasRecientes: leerParadasRecientes };
}

export interface ResultadoDeteccionParada {
  revisados: number;
  preguntas: number;
  cerrados: number;
  escaladas: number;
  yaReclamadas: number;
  sinTelefono: number;
  sinDestinatario: number;
  fueraDeVentana: number;
  compuertaMovimiento: number;
  rechazosReintentables: number;
  fallos: string[];
}

const avisoMinDe = (c: ConfigConductor): number => c.detenidoAvisoMin ?? CONFIG_CONDUCTOR_DEFAULT.detenidoAvisoMin ?? 15;

/** Cuánto GPS hay que leer para esta flota: el umbral de aviso más la cadencia más lenta configurada (y un margen). */
function lookbackMin(c: ConfigConductor): number {
  const poleos = [c.poleoMin, ...Object.values(c.poleoPorClaveMin ?? {})].filter((n): n is number => typeof n === 'number' && n > 0);
  return Math.max(avisoMinDe(c) + Math.max(POLEO_CONSERVADOR_MIN, ...poleos) + 10, lapsoMaxCompuertaMin(c) + 5);
}

/**
 * Una pasada: a cada viaje en tránsito de una flota con `deteccionParadaActiva` cuya unidad lleva detenida `detenidoAvisoMin` sin parada
 * le toca (o no) UNA pregunta por episodio. Orden: decidir (pura) → claim → bitácora «pregunta» → envío. Nunca lanza por un viaje: lo
 * anota en `fallos`; sin GPS, sin bitácora o sin paradas legibles no manda nada (ante la duda, silencio).
 */
export async function correrDeteccionParada(
  p: PuertosDetencion, opts: { ahora?: Date; venceEn?: number } = {},
): Promise<ResultadoDeteccionParada> {
  const ahora = opts.ahora ?? new Date();
  const r: ResultadoDeteccionParada = {
    revisados: 0, preguntas: 0, cerrados: 0, escaladas: 0, yaReclamadas: 0, sinTelefono: 0, sinDestinatario: 0,
    fueraDeVentana: 0, compuertaMovimiento: 0, rechazosReintentables: 0, fallos: [],
  };
  const viajes = await p.viajesActivos(400);
  if (viajes.length === 0) return r;

  const configs = new Map<string, ConfigConductor | null>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try { configs.set(t, await p.configDe(t)); } catch (e) {
      configs.set(t, null);
      logger.error('conductor.detencion_config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }
  let candidatos = viajes.filter((v) => {
    const c = configs.get(v.tenantId);
    return Boolean(c && c.activo && c.deteccionParadaActiva === true && v.unidadId);
  });
  if (candidatos.length === 0) return r;
  if (!p.muestrasUnidad) { r.fallos.push('detención sin aviso: no hay puerto de GPS; no se pregunta nada'); return r; }

  const hitos = await p.hitosDe(candidatos.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);
  candidatos = candidatos.filter((v) => hitoAncla(porViaje.get(v.id) ?? []) !== null);

  // La bitácora y las paradas se leen UNA vez por flota. Sin ellas no se sabe qué ya se preguntó ni si el chofer avisó: silencio en esa flota.
  const eventos: EventoDetencionFila[] = [];
  const paradas: ParadaFila[] = [];
  for (const t of new Set(candidatos.map((v) => v.tenantId))) {
    const ids = candidatos.filter((v) => v.tenantId === t).map((v) => v.id);
    try {
      const desde = new Date(ahora.getTime() - avisoMinDe(configs.get(t)!) * 60_000);
      eventos.push(...await p.eventosDetencion(t, ids));
      paradas.push(...await p.paradasRecientes(t, ids, desde));
    } catch (e) {
      candidatos = candidatos.filter((v) => v.tenantId !== t);
      r.fallos.push(`detención sin aviso (flota ${t.slice(0, 8)}): no se pudo leer la bitácora o las paradas: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (candidatos.length === 0) return r;

  // El GPS y los sitios del viaje (exención «dentro del sitio»): sin ellos no se sabe si está en la planta; falla cerrado.
  const unidades: UnidadDeViaje[] = [...new Map(candidatos.map((v) => [`${v.tenantId}|${v.unidadId}`, { tenantId: v.tenantId, unidadId: v.unidadId! }])).values()];
  let muestras = new Map<string, MuestraGps[]>();
  let sitios = new Map<string, SitiosViaje>();
  try {
    const minutos = Math.max(...candidatos.map((v) => lookbackMin(configs.get(v.tenantId)!)));
    muestras = await p.muestrasUnidad(unidades, new Date(ahora.getTime() - minutos * 60_000));
    sitios = p.sitiosDe ? await p.sitiosDe(candidatos) : sitios;
  } catch (e) {
    r.fallos.push(`detención sin aviso: no se pudo leer el GPS: ${e instanceof Error ? e.message : String(e)}`);
    logger.error('conductor.detencion_gps_fallo', { err: e instanceof Error ? e.message : String(e) });
    return r;
  }

  // T-A5-68: la señal de conducción del proveedor, una lectura por unidad (sin puerto o sin dato = solo-GPS + la ignición del GPS).
  const senales = await leerSenalesDeUnidades(p.senalesConduccion, candidatos.map((v) => v.unidadId!), ahora);
  for (const v of candidatos) {
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) break;
    const config = configs.get(v.tenantId)!;
    const hs = porViaje.get(v.id) ?? [];
    const ancla = hitoAncla(hs)!;
    r.revisados++;
    const posiciones = muestras.get(`${v.tenantId}|${v.unidadId}`) ?? [];
    const claves = clavesPoleoDe(v.unidadId, posiciones);
    const sitioDelViaje = sitios.get(v.id) ?? null;
    const ultima = [...posiciones].sort((a, b) => b.medidaEn.getTime() - a.medidaEn.getTime())[0];
    const delViaje = paradas.filter((x) => x.viajeId === v.id);
    const senalExtra = combinarSenal(senales.get(v.unidadId!), ultima?.ignicion);
    const estado = estadoDetencionDeEventos(eventos, v.id);
    const decision = decidirDetencion({
      activo: true, enTransito: enTransito(hs), estado, ahora,
      paradaAbierta: delViaje.some((x) => x.fin === null),
      paradaReciente: delViaje.some((x) => x.fin !== null),
      elegibilidad: detencionElegible({ posiciones, sitioDelViaje, config, ahora, clavesPoleo: claves, senalExtra }),
      // T-A5-36: pasa por la compuerta de unidad detenida como todo mensaje proactivo (apagada = permitido; la elegibilidad exige GPS igual).
      compuerta: puedeEscribirAlChofer({ posiciones, clavesPoleo: claves, sitioDelViaje, config, ahora, senalExtra }),
      dentroDeVentana: dentroDeVentana(config, ahora), tieneTelefono: Boolean(v.operadorTelefono),
      escalaSinRespuestaMin: config.detencionEscalaSinRespuestaMin,
    });
    if (decision.accion === 'nada') {
      if (decision.razon === 'fuera_de_ventana') r.fueraDeVentana++;
      else if (decision.razon === 'compuerta_movimiento') r.compuertaMovimiento++;
      else if (decision.razon === 'sin_telefono') r.sinTelefono++;
      continue;
    }
    try {
      if (decision.accion === 'cerrar') {
        if (await p.guardarEventoDetencion(ancla, { tipo: 'cierre', motivo: decision.motivo })) r.cerrados++;
        else r.fallos.push(`detención ${v.folio ?? v.id}: no se pudo cerrar el episodio en la bitácora`);
      } else if (decision.accion === 'escalar') {
        await escalar(p, v, ancla, estado, config, ahora, r);
      } else {
        await preguntar(p, v, ancla, decision.ordinal, config, ahora, r);
      }
    } catch (err) {
      r.fallos.push(`detención ${v.folio ?? v.id}: ${err instanceof Error ? err.message : 'error inesperado'}`);
      logger.error('conductor.detencion_viaje_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    }
  }
  return r;
}

async function preguntar(p: PuertosDetencion, v: ViajeContexto, ancla: HitoFila, ordinal: number, config: ConfigConductor, ahora: Date, r: ResultadoDeteccionParada): Promise<void> {
  const claim: NuevoAviso = {
    tenantId: v.tenantId, viajeId: v.id, hitoId: ancla.id, operadorId: v.operadorId,
    ciclo: CICLO_BASE_CLAIM_DETENCION + ordinal, clase: 'escalacion', nivel: NIVEL_PREGUNTA_DETENCION,
  };
  const etiqueta = v.folio ?? v.id;
  const gano = await p.reclamar(claim);
  if (gano === 'perdido') { r.yaReclamadas++; return; }
  if (gano === 'fallo') { r.fallos.push(`reclamo detención ${etiqueta}`); return; }
  // La bitácora ANTES del envío: «ya se preguntó» y el claim dicen lo mismo aunque Meta rechace. Si no se puede escribir, se suelta el
  // claim y no se manda nada (la pasada siguiente lo vuelve a intentar entera).
  if (!await p.guardarEventoDetencion(ancla, { tipo: 'pregunta', ordinal })) {
    await p.liberarAviso(claim);
    r.fallos.push(`detención ${etiqueta}: no se pudo anotar la pregunta en la bitácora`);
    return;
  }
  const ult4 = v.operadorTelefono!.slice(-4);
  const envio = await p.enviar(v.operadorTelefono!, armarPreguntaDetencion(v, avisoMinDe(config)), 'conductor.deteccion_parada', v.tenantId, ahora);
  if (envio.ok) {
    await p.cerrarAviso(claim, { ok: true, canal: envio.via, motivo: null, ult4 });
    r.preguntas++;
  } else {
    // Reintentable = ya quedó en `wa_outbox` (soltar el claim duplicaría la pregunta). Definitivo = cerrada sin ok: no se insiste.
    await p.cerrarAviso(claim, { ok: envio.reintentable, canal: envio.reintentable ? 'texto' : 'ninguno', motivo: envio.reintentable ? 'en_cola_outbox' : envio.mensaje.slice(0, 200), ult4 });
    if (envio.reintentable) r.rechazosReintentables++;
    r.fallos.push(`detención ${etiqueta}: ${envio.mensaje}`);
  }
}

async function escalar(p: PuertosDetencion, v: ViajeContexto, ancla: HitoFila, estado: EstadoDetencion, config: ConfigConductor, ahora: Date, r: ResultadoDeteccionParada): Promise<void> {
  const etiqueta = v.folio ?? v.id;
  // La marca ANTES del aviso: un fallo a medias nunca produce un segundo aviso al supervisor por el mismo episodio.
  if (!await p.guardarEventoDetencion(ancla, { tipo: 'escalada' })) { r.fallos.push(`detención ${etiqueta}: no se pudo anotar la escalada`); return; }
  const minutos = estado.preguntadoEn ? Math.max(0, Math.round((ahora.getTime() - Date.parse(estado.preguntadoEn)) / 60_000)) + avisoMinDe(config) : avisoMinDe(config);
  const res = await avisarSupervisor(p, v, armarAvisoDetencion(v, 'sin_respuesta', minutos, ahora, config.zonaHoraria), 'conductor.deteccion_parada_sin_respuesta', ahora);
  if (res === 'entregado' || res === 'en_cola') { r.escaladas++; return; }
  if (res === 'sin_destinatario') { r.sinDestinatario++; r.fallos.push(`${etiqueta}: no hay a quién avisar la detención sin respuesta`); return; }
  r.fallos.push(`detención ${etiqueta}: el aviso al supervisor fue rechazado`);
}

// ── La entrada: lo que contesta el chofer ────────────────────────────────────

export interface PuertosDetencionAtender extends Pick<PuertosConductor, 'destinatarios' | 'enviar'> {
  eventosDetencion(tenantId: string, viajeIds: string[]): Promise<EventoDetencionFila[]>;
  guardarEventoDetencion(h: HitoFila, detalle: Record<string, string | number | boolean | null>): Promise<boolean>;
}

export function puertosDetencionAtenderReales(): PuertosDetencionAtender {
  const motor = puertosReales();
  return { destinatarios: motor.destinatarios, enviar: motor.enviar, eventosDetencion: leerEventosDetencion, guardarEventoDetencion };
}

export interface EntradaRespuestaDetencion {
  viaje: ViajeContexto;
  hitos: readonly HitoFila[];
  config: Pick<ConfigConductor, 'deteccionParadaActiva' | 'zonaHoraria'> & Partial<Pick<ConfigConductor, 'detenidoAvisoMin'>>;
  ahora: Date;
  opcion: OpcionDetencion;
}

/**
 * Un botón de N05. Los botones SIEMPRE contestan algo (uno viejo no se queda mudo). El llamador ya comprobó que el viaje es del chofer y no
 * está liquidado. «Necesito apoyo» se atiende aunque el episodio ya esté cerrado (es una petición de ayuda, no una pregunta vigente).
 * Nunca lanza.
 */
export async function responderDetencion(p: PuertosDetencionAtender, x: EntradaRespuestaDetencion): Promise<Salida[]> {
  const { viaje: v, ahora } = x;
  try {
    if (x.config.deteccionParadaActiva !== true) return [{ texto: TEXTO_DETENCION_NO_VIGENTE }];
    const ancla = hitoAncla(x.hitos);
    if (!ancla) return [{ texto: TEXTO_DETENCION_NO_VIGENTE }];
    const st = estadoDetencionDeEventos(await p.eventosDetencion(v.tenantId, [v.id]), v.id);

    if (x.opcion === 'ok') {
      if (!st.abierto) return [{ texto: TEXTO_DETENCION_NO_VIGENTE }];
      if (st.respuesta === null && !await p.guardarEventoDetencion(ancla, { tipo: 'respuesta', opcion: 'ok' })) return [{ texto: TEXTO_DETENCION_FALLO }];
      return [{ texto: TEXTO_DETENCION_OK }];
    }
    if (x.opcion === 'motivo') {
      if (!st.abierto) return [{ texto: TEXTO_DETENCION_NO_VIGENTE }];
      if (st.respuesta === null && !await p.guardarEventoDetencion(ancla, { tipo: 'respuesta', opcion: 'motivo' })) return [{ texto: TEXTO_DETENCION_FALLO }];
      return [salidaMotivos(v.id, 0)];
    }
    // «Necesito apoyo»: la respuesta primero (el episodio queda contestado), luego el aviso; el resultado del aviso se anota para que un
    // reintento solo repita si el supervisor NO se enteró.
    if (st.apoyoAvisado) return [{ texto: TEXTO_APOYO_YA_AVISADO }];
    if (st.abierto && st.respuesta === null) await p.guardarEventoDetencion(ancla, { tipo: 'respuesta', opcion: 'apoyo' });
    const minutos = x.config.detenidoAvisoMin ?? CONFIG_CONDUCTOR_DEFAULT.detenidoAvisoMin ?? 15;
    const res = await avisarSupervisor(p, v, armarAvisoDetencion(v, 'apoyo', minutos, ahora, x.config.zonaHoraria), 'conductor.deteccion_parada_apoyo', ahora);
    const entregado = res === 'entregado' || res === 'en_cola';
    await p.guardarEventoDetencion(ancla, { tipo: 'apoyo', entregado });
    return [{ texto: entregado ? TEXTO_APOYO_AVISADO : TEXTO_APOYO_SIN_AVISO }];
  } catch (err) {
    logger.error('conductor.deteccion_respuesta_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return [{ texto: TEXTO_DETENCION_FALLO }];
  }
}

/** La página 1 o 2 de la lista de motivos (botón «Más opciones»). Con la perilla apagada, «ya no está vigente». */
export function responderPaginaMotivos(config: Pick<ConfigConductor, 'deteccionParadaActiva'>, viajeId: string, pagina: 1 | 2): Salida[] {
  if (config.deteccionParadaActiva !== true) return [{ texto: TEXTO_DETENCION_NO_VIGENTE }];
  return [salidaMotivos(viajeId, pagina)];
}

export interface EntradaParada {
  viaje: ViajeContexto;
  config: Pick<ConfigConductor, 'deteccionParadaActiva'>;
  ahora: Date;
  orden: OrdenParada;
}

/**
 * La parada que inicia el chofer (T-A5-38) — «parada», un motivo, «ya continúo» — ejecutada con la base real. La lista de motivos sale en
 * páginas de tres botones. Con la perilla apagada no hace nada (`null`: el mensaje sigue su camino). Nunca lanza.
 */
export async function responderParada(deps: DepsParada, x: EntradaParada): Promise<Salida[] | null> {
  if (x.config.deteccionParadaActiva !== true) return null;
  const { viaje: v } = x;
  try {
    const s = await ejecutarParada({ tenantId: v.tenantId, viajeId: v.id, orden: x.orden, ahora: x.ahora }, deps);
    if (s.lista) return [salidaMotivos(v.id, 0)];
    return [{ texto: s.texto, ...(s.botones && s.botones.length > 0 ? { botones: s.botones } : {}) }];
  } catch (err) {
    logger.error('conductor.parada_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return [{ texto: TEXTO_DETENCION_FALLO }];
  }
}
