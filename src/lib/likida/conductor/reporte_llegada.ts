import { logger } from '@/lib/logger';
import { dentroDeVentana, type ConfigConductor } from './config';
import type { ResultadoCompuerta } from './compuerta_movimiento';
import { evaluarCompuertaDeViajes, puertosReales, type NuevoAviso, type PuertosConductor } from './ejecutor';
import { armarPreguntaReporte } from './alertas_llegada';
import {
  interpretarRampaTexto, limpiarComoDescarga, type BotonRampa, type EstadoRampa,
} from './interprete';
import {
  agregarReubicacion, decidirReporteLlegada, estadoReporte, hitoLlegadaDelReporte, MINUTOS_ESPERA_PASO_REPORTE,
  type PasoReporte, type PreguntadosReporte, type Reubicacion,
} from './maquina';
import { acuseRampa, preguntaRampa, TEXTO_PEDIR_NUMERO_RAMPA, type Salida } from './mensajes';
import { guardarEventoReporte, leerEventosReporte, type EventoReporteFila, type ViajeContexto } from './repo';
import type { HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-43 — «CON QUIÉN TE REPORTASTE» Y LA RAMPA: EL CABLEADO (cron que pregunta, entrada que recibe, bitácora que guarda).
//
// Requisito del cliente (R15, R16): a la llegada con el cliente se pregunta con quién se reportó el operador (los clientes cambian de
// rampa o de edificio y lo mandan «como canica») y, en IMPORTACIÓN, la rampa de descarga: sí / no / no aplica / en espera + número;
// «no aplica» ofrece «¿cómo descargas?» como pregunta OPCIONAL. El cliente pidió trabajar por excepciones: una pregunta por paso, sin
// insistir, y sin respuesta el ciclo del viaje sigue.
//
// Quién invoca qué (todo apagado por omisión: `config.reporteLlegadaActivo`, y el módulo A5 va «Próximamente» en el perfil de fase 1):
//   · PREGUNTA  → `correrReporteLlegada`, desde el cron `/api/cron/conductor-hitos` (aislado como las demás pasadas). Pasa por la
//                 compuerta de unidad detenida (T-A5-36) ANTES del claim y se vuelve a evaluar en la pasada siguiente si va rodando.
//   · RESPUESTA → `responderReporteBoton` / `responderReporteTexto`, desde `atenderConductor` (la entrada del processor).
//   · TABLERO   → `mapaReubicaciones`, desde la página de conductores, compone la lista sobre cada llegada (`conReporteDeLlegada`).
//
// ── PERSISTENCIA (sin migración; Ruling) ────────────────────────────────────
//   Renglones `validacion` de la bitácora `viaje_hito_evento` con `detalle.clase = 'reporte_llegada'` (ver `guardarEventoReporte`):
//     · `{ tipo: 'pregunta', paso, ciclo }`                      — se preguntó ese paso (una vez; el claim es `escalacion` nivel 3/4/5)
//     · `{ tipo: 'rampa', estado, numero, ciclo }`                — respuesta de rampa (cada cambio de rampa agrega UN renglón: la lista)
//     · `{ tipo: 'como', texto | null, omitido, ciclo }`          — «¿cómo descargas?»
//   La LISTA DE REUBICACIONES (R15) se reconstruye en orden: cada renglón de rampa o de «cómo» es un registro con su hora. La tabla
//   prohíbe datos personales en `detalle`: el NOMBRE del contacto sigue en `viaje_hito.contacto_nombre` (lo escribe el flujo de siempre
//   al contestar la pregunta) y el historial de nombres NO se guarda. Si T-A5-63 necesita ese historial, hace falta una tabla con slot
//   de migración 0820–0829 (ver _construccion/T-A5-43.md).
// ═══════════════════════════════════════════════════════════════════════════

/** Niveles del claim `escalacion` reservados para este reporte (0–2 son del ciclo; 7 patio; 8 estadía). */
export const NIVEL_PREGUNTA_REPORTE: Readonly<Record<PasoReporte, number>> = { contacto: 3, rampa: 4, como_descarga: 5 };

const una = (t: string, n: number): string => t.replace(/\s+/g, ' ').trim().slice(0, n);

// ── Leer la bitácora: del renglón a la lista ─────────────────────────────────

export interface EstadoReporteHito {
  reubicaciones: Reubicacion[];
  preguntados: PreguntadosReporte;
  /** El chofer ya contestó (o saltó) «¿cómo descargas?». */
  comoCerrada: boolean;
  /** Hubo respuesta de rampa. */
  rampaRespondida: boolean;
}

const esEstado = (v: unknown): v is EstadoRampa => v === 'si' || v === 'no' || v === 'no_aplica' || v === 'en_espera';
const esPaso = (v: unknown): v is PasoReporte => v === 'contacto' || v === 'rampa' || v === 'como_descarga';

/** Reconstruye el estado del reporte de UNA llegada (hito + ciclo) a partir de la bitácora, en el orden en que se escribió. Pura. */
export function estadoReporteDeEventos(eventos: readonly EventoReporteFila[], hitoId: string, ciclo: number): EstadoReporteHito {
  let reubicaciones: Reubicacion[] = [];
  const preguntados: PreguntadosReporte = {};
  let comoCerrada = false;
  let rampaRespondida = false;
  for (const ev of eventos) {
    if (ev.hitoId !== hitoId) continue;
    const d = ev.detalle;
    if (Number(d.ciclo) !== ciclo) continue;
    const en = new Date(ev.creadoEn);
    if (d.tipo === 'pregunta' && esPaso(d.paso)) {
      if (preguntados[d.paso] === undefined) preguntados[d.paso] = en.toISOString();
    } else if (d.tipo === 'rampa' && esEstado(d.estado)) {
      rampaRespondida = true;
      reubicaciones = agregarReubicacion(reubicaciones, { rampaEstado: d.estado, rampa: typeof d.numero === 'string' ? d.numero : null, comoDescarga: null }, en, 'chofer');
      if (d.estado !== 'no_aplica') comoCerrada = false;
    } else if (d.tipo === 'como') {
      comoCerrada = true;
      if (typeof d.texto === 'string' && d.texto) reubicaciones = agregarReubicacion(reubicaciones, { comoDescarga: d.texto }, en, 'chofer');
    }
  }
  return { reubicaciones, preguntados, comoCerrada, rampaRespondida };
}

/** Para el tablero: hitoId → su lista de reubicaciones (solo las llegadas que tienen alguna). */
export function mapaReubicaciones(eventos: readonly EventoReporteFila[], hitos: readonly HitoFila[]): Map<string, Reubicacion[]> {
  const m = new Map<string, Reubicacion[]>();
  for (const h of hitos) {
    if (h.tipo !== 'llegada_descarga' && h.tipo !== 'llegada_carga') continue;
    const lista = estadoReporteDeEventos(eventos, h.id, h.ciclo).reubicaciones;
    if (lista.length > 0) m.set(h.id, lista);
  }
  return m;
}

// ── El cron: la pregunta proactiva ───────────────────────────────────────────

export interface PuertosReporte extends Pick<PuertosConductor, 'viajesActivos' | 'hitosDe' | 'configDe' | 'reclamar' | 'cerrarAviso' | 'liberarAviso' | 'enviar' | 'muestrasUnidad' | 'sitiosDe'> {
  eventosReporte(tenantId: string, viajeIds: string[]): Promise<EventoReporteFila[]>;
  guardarEventoReporte(h: HitoFila, detalle: Record<string, string | number | boolean | null>): Promise<boolean>;
}

export function puertosReporteReales(): PuertosReporte {
  return { ...puertosReales(), eventosReporte: leerEventosReporte, guardarEventoReporte };
}

export interface ResultadoReporteLlegada {
  revisados: number;
  preguntas: number;
  yaReclamadas: number;
  sinTelefono: number;
  fueraDeVentana: number;
  compuertaMovimiento: number;
  rechazosReintentables: number;
  fallos: string[];
}

/**
 * Una pasada: a cada viaje de una flota con `reporteLlegadaActivo` cuya llegada ya está registrada, le toca (o no) UNA pregunta.
 * Orden de cada pregunta: decidir (pura) → claim → bitácora «preguntado» → envío. Sin teléfono o con un rechazo, el claim se cierra
 * y NO se repite; el ciclo del viaje no depende de la respuesta. Nunca lanza por un viaje: lo anota en `fallos`.
 */
export async function correrReporteLlegada(
  p: PuertosReporte, opts: { ahora?: Date; venceEn?: number } = {},
): Promise<ResultadoReporteLlegada> {
  const ahora = opts.ahora ?? new Date();
  const r: ResultadoReporteLlegada = { revisados: 0, preguntas: 0, yaReclamadas: 0, sinTelefono: 0, fueraDeVentana: 0, compuertaMovimiento: 0, rechazosReintentables: 0, fallos: [] };
  const viajes = await p.viajesActivos(400);
  if (viajes.length === 0) return r;

  const configs = new Map<string, ConfigConductor | null>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try { configs.set(t, await p.configDe(t)); } catch (e) {
      configs.set(t, null);
      logger.error('conductor.reporte_config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }
  const encendidos = viajes.filter((v) => { const c = configs.get(v.tenantId); return Boolean(c && c.activo && c.reporteLlegadaActivo === true); });
  if (encendidos.length === 0) return r;

  const hitos = await p.hitosDe(encendidos.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);
  const candidatos = encendidos.filter((v) => hitoLlegadaDelReporte(porViaje.get(v.id) ?? [], v.servicio ?? null) !== null);
  if (candidatos.length === 0) return r;

  // La bitácora se lee UNA vez por flota; la compuerta, una vez por pasada.
  const eventos: EventoReporteFila[] = [];
  for (const t of new Set(candidatos.map((v) => v.tenantId))) {
    try { eventos.push(...await p.eventosReporte(t, candidatos.filter((v) => v.tenantId === t).map((v) => v.id))); } catch (e) {
      // Sin la bitácora no se sabe qué ya se preguntó: ante la duda, silencio en esa flota.
      candidatos.splice(0, candidatos.length, ...candidatos.filter((v) => v.tenantId !== t));
      r.fallos.push(`reporte de llegada (flota ${t.slice(0, 8)}): no se pudo leer la bitácora: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (candidatos.length === 0) return r;
  const compuerta = await evaluarCompuertaDeViajes(p, candidatos, configs, ahora);

  for (const v of candidatos) {
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) break;
    const config = configs.get(v.tenantId)!;
    const hs = porViaje.get(v.id) ?? [];
    const llegada = hitoLlegadaDelReporte(hs, v.servicio ?? null);
    if (!llegada) continue;
    r.revisados++;
    if (!dentroDeVentana(config, ahora)) { r.fueraDeVentana++; continue; }
    const estado = estadoReporteDeEventos(eventos, llegada.id, llegada.ciclo);
    const d = decidirReporteLlegada({
      activo: true, hitos: hs, servicio: v.servicio ?? null, reubicaciones: estado.reubicaciones, sinContacto: false,
      preguntados: estado.preguntados, compuerta: (compuerta.get(v.id) as ResultadoCompuerta | undefined) ?? { permitido: true, razon: 'compuerta_apagada' }, ahora,
      esperaMin: MINUTOS_ESPERA_PASO_REPORTE,
    });
    if (d.accion === 'nada') { if (d.razon === 'en_movimiento') r.compuertaMovimiento++; continue; }
    await preguntar(p, v, llegada, d.paso, ahora, r);
  }
  return r;
}

async function preguntar(p: PuertosReporte, v: ViajeContexto, h: HitoFila, paso: PasoReporte, ahora: Date, r: ResultadoReporteLlegada): Promise<void> {
  const claim: NuevoAviso = { tenantId: v.tenantId, viajeId: v.id, hitoId: h.id, operadorId: v.operadorId, ciclo: h.ciclo, clase: 'escalacion', nivel: NIVEL_PREGUNTA_REPORTE[paso] };
  const etiqueta = v.folio ?? v.id;
  try {
    const gano = await p.reclamar(claim);
    if (gano === 'perdido') { r.yaReclamadas++; return; }
    if (gano === 'fallo') { r.fallos.push(`reclamo reporte ${paso} ${etiqueta}`); return; }
    if (!v.operadorTelefono) {
      await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_telefono', ult4: null });
      await p.guardarEventoReporte(h, { tipo: 'pregunta', paso, ciclo: h.ciclo });
      r.sinTelefono++;
      return;
    }
    // La bitácora ANTES del envío: así «ya se preguntó» y el claim dicen lo mismo aunque Meta rechace. Si no se puede escribir, se suelta el claim y no se manda nada.
    if (!await p.guardarEventoReporte(h, { tipo: 'pregunta', paso, ciclo: h.ciclo })) {
      await p.liberarAviso(claim);
      r.fallos.push(`reporte ${paso} ${etiqueta}: no se pudo anotar la pregunta en la bitácora`);
      return;
    }
    const envio = await p.enviar(v.operadorTelefono, armarPreguntaReporte(paso, v, h), 'conductor.reporte_llegada', v.tenantId, ahora);
    const ult4 = v.operadorTelefono.slice(-4);
    if (envio.ok) {
      await p.cerrarAviso(claim, { ok: true, canal: envio.via, motivo: null, ult4 });
      r.preguntas++;
    } else {
      // Reintentable = ya quedó en `wa_outbox` (soltar el claim duplicaría la pregunta). Definitivo = cerrada sin ok: no se insiste.
      await p.cerrarAviso(claim, { ok: envio.reintentable, canal: envio.reintentable ? 'texto' : 'ninguno', motivo: envio.reintentable ? 'en_cola_outbox' : envio.mensaje.slice(0, 200), ult4 });
      if (envio.reintentable) r.rechazosReintentables++;
      r.fallos.push(`reporte ${paso} ${etiqueta}: ${envio.mensaje}`);
    }
  } catch (err) {
    r.fallos.push(`reporte ${paso} ${etiqueta}: ${err instanceof Error ? err.message : 'error inesperado'}`);
    logger.error('conductor.reporte_pregunta_fallo', { viaje: v.id, paso, err: err instanceof Error ? err.message : String(err) });
  }
}

// ── La entrada: lo que contesta el chofer ────────────────────────────────────

export interface PuertosReporteAtender {
  eventosReporte(tenantId: string, viajeIds: string[]): Promise<EventoReporteFila[]>;
  guardarEventoReporte(h: HitoFila, detalle: Record<string, string | number | boolean | null>): Promise<boolean>;
}
export const puertosReporteAtenderReales = (): PuertosReporteAtender => ({ eventosReporte: leerEventosReporte, guardarEventoReporte });

export const TEXTO_REPORTE_NO_VIGENTE = 'Ese aviso ya no está vigente. 👍';
const TEXTO_SIN_LLEGADA = 'Todavía no tengo tu llegada anotada. Avísame cuando llegues. 📍';
const TEXTO_FALLO = 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏';
const TEXTO_COMO_OMITIDA = 'Va, sin problema. 👍';

export interface EntradaReporte {
  viaje: ViajeContexto;
  hitos: readonly HitoFila[];
  config: Pick<ConfigConductor, 'reporteLlegadaActivo'>;
  ahora: Date;
}

/** Escribe un renglón y devuelve si quedó guardado. */
const guardar = (p: PuertosReporteAtender, h: HitoFila, detalle: Record<string, string | number | boolean | null>) => p.guardarEventoReporte(h, { ...detalle, ciclo: h.ciclo });

/**
 * Un botón de la rampa o del «¿cómo descargas?». Los botones SIEMPRE contestan algo (un botón viejo no se queda mudo). El llamador ya
 * comprobó que el viaje del botón es del chofer y no está liquidado. Nunca lanza.
 */
export async function responderReporteBoton(p: PuertosReporteAtender, x: EntradaReporte, boton: BotonRampa): Promise<Salida[]> {
  const { viaje: v } = x;
  try {
    if (x.config.reporteLlegadaActivo !== true) return [{ texto: TEXTO_REPORTE_NO_VIGENTE }];
    const llegada = hitoLlegadaDelReporte(x.hitos, v.servicio ?? null);
    if (!llegada) return [{ texto: TEXTO_SIN_LLEGADA }];
    // La rampa solo existe en importación (R16): en otro servicio el botón no tiene a qué responder.
    if (v.servicio !== 'importacion') return [{ texto: TEXTO_REPORTE_NO_VIGENTE }];
    if (boton.accion === 'mas') return [preguntaRampa(v.id, 1)];

    const st = estadoReporteDeEventos(await p.eventosReporte(v.tenantId, [v.id]), llegada.id, llegada.ciclo);
    const vigente = estadoReporte(st.reubicaciones);
    if (boton.accion === 'omitir_como') {
      if (vigente?.rampaEstado !== 'no_aplica' || st.comoCerrada) return [{ texto: TEXTO_COMO_OMITIDA }];
      return await guardar(p, llegada, { tipo: 'como', texto: null, omitido: true }) ? [{ texto: TEXTO_COMO_OMITIDA }] : [{ texto: TEXTO_FALLO }];
    }
    return await registrarRampa(p, llegada, st, boton.estado, null);
  } catch (err) {
    logger.error('conductor.reporte_boton_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return [{ texto: TEXTO_FALLO }];
  }
}

async function registrarRampa(p: PuertosReporteAtender, llegada: HitoFila, st: EstadoReporteHito, estado: EstadoRampa, numero: string | null): Promise<Salida[]> {
  const vigente = estadoReporte(st.reubicaciones);
  // Mismo estado y mismo número que lo vigente: se acusa sin agregar otro registro (un duplicado no infla la evidencia).
  if (vigente?.rampaEstado === estado && (vigente.rampa ?? null) === (numero ?? vigente.rampa ?? null)) return [{ texto: acuseRampa(estado, vigente.rampa ?? null) }];
  if (!await guardar(p, llegada, { tipo: 'rampa', estado, numero: estado === 'si' ? numero : null })) return [{ texto: TEXTO_FALLO }];
  const acuse: Salida[] = [{ texto: acuseRampa(estado, estado === 'si' ? numero : null) }];
  if (estado === 'si' && !numero) acuse.push({ texto: TEXTO_PEDIR_NUMERO_RAMPA });
  return acuse;
}

/**
 * Un texto del chofer que NINGUNA regla de hitos entendió: ¿contesta una pregunta abierta de rampa (o su número) o el «¿cómo descargas?»?
 * `null` = no es de este módulo (sigue su camino al agente). Solo contesta si la pregunta está abierta; nunca lanza.
 */
export async function responderReporteTexto(p: PuertosReporteAtender, x: EntradaReporte, texto: string): Promise<Salida[] | null> {
  const { viaje: v } = x;
  try {
    if (x.config.reporteLlegadaActivo !== true || v.servicio !== 'importacion') return null;
    const llegada = hitoLlegadaDelReporte(x.hitos, v.servicio);
    if (!llegada) return null;
    const st = estadoReporteDeEventos(await p.eventosReporte(v.tenantId, [v.id]), llegada.id, llegada.ciclo);
    const vigente = estadoReporte(st.reubicaciones);

    const rampaAbierta = st.preguntados.rampa !== undefined && !st.rampaRespondida;
    const faltaNumero = vigente?.rampaEstado === 'si' && !vigente.rampa;
    // Con la rampa ya en «sí», solo un NÚMERO es respuesta (un «no» suelto no la desdice) y, si ya tenía número, un cambio exige decir «rampa 9»
    // (o andén, puerta, dock, muelle): es el «como canica» del cliente y cada cambio agrega un registro a la lista.
    const cambioExplicito = vigente?.rampaEstado === 'si' && /\b(rampa|rampas|anden|andenes|puerta|dock|muelle)\b/i.test(texto.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    if (rampaAbierta || faltaNumero || cambioExplicito) {
      const resp = interpretarRampaTexto(texto);
      if (resp && (rampaAbierta || (resp.estado === 'si' && resp.numero))) return await registrarRampa(p, llegada, st, resp.estado, resp.numero);
    }
    const comoAbierta = st.preguntados.como_descarga !== undefined && vigente?.rampaEstado === 'no_aplica' && !vigente.comoDescarga && !st.comoCerrada;
    if (comoAbierta) {
      const limpio = limpiarComoDescarga(texto);
      if (!limpio) return null;
      if (!await guardar(p, llegada, { tipo: 'como', texto: una(limpio, 120), omitido: false })) return [{ texto: TEXTO_FALLO }];
      return [{ texto: `Anotado ✅ descargas: ${una(limpio, 60)}.` }];
    }
    return null;
  } catch (err) {
    logger.error('conductor.reporte_texto_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
