import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import { parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import type { ConfigConductor } from './config';
import type { NuevoAviso, PuertosConductor } from './ejecutor';
import { puertosReales } from './ejecutor';
import { acuseResultadoDescarga, preguntaResultadoDescarga, type OpcionResultadoDescarga, type Salida } from './mensajes';
import type { EventoPatioFila, ViajeContexto } from './repo';
import { leerEventosResultadoDescarga, registrarEventoConfirmado } from './repo';
import type { MensajeSaliente } from './solicitudes';
import { PREFIJO_BOTON, estaResuelto, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-46 — RESULTADO DE LA DESCARGA Y CAJA CARGADA (R19; R18: el fin de descarga cierra el ciclo).
//
// Requisito del cliente (reunión 15-oct, 57:05–58:57): al terminar de descargar, el agente pregunta «¿se descargó todo? ¿no te
// recibieron la mercancía? ¿te llevas la caja cargada a patio?» y, si la caja regresa cargada, avisa a quien tenga que enterarse
// (en Guadalajara hay un convenio de 4 h con un cliente: si no descargan, el operador se regresa).
//
// ── CÓMO ENCAJA ────────────────────────────────────────────────────────────
//   · Pregunta: `atender.ts` llama a `preguntarResultado` justo después de registrar la SALIDA de descarga del chofer («ya salí /
//     terminé»). Es respuesta a SU mensaje (no proactiva: no pasa por la compuerta de «unidad detenida»). Solo con
//     `resultadoDescargaActivo` (apagado hasta la fase 2). SIN respuesta no bloquea nada: el regreso se registra igual y el ciclo cierra.
//   · Respuesta: botón `resultado_descarga:<viaje>:completa|no_recibida|caja_cargada` o, con la pregunta abierta, el texto equivalente.
//       completa    → acuse y el ciclo sigue normal.
//       no_recibida / caja_cargada → UN aviso al supervisor (claim `escalacion` nivel 6 sobre la salida de descarga: dos toques o las dos
//                     opciones NO lo duplican, y alinea el aviso con el de estadía de T-A5-45) y el hito `regreso` se fija con la bandera
//                     `caja_cargada` (`atender.ts` lo registra con la misma máquina que un «voy de regreso»).
//   · Sin destinatario NO es silencio: el claim queda cerrado con el motivo y la bitácora lo dice (alerta interna para el tablero).
//
// ── PERSISTENCIA (sin migración; mismo Ruling que el patio de T-A5-44) ──────
//   Bitácora `viaje_hito_evento`, evento `validacion`, `detalle.clase = 'resultado_descarga'`: `estado` preguntado | respondido |
//   alertado (colgados de la salida de descarga) y `caja_cargada` (colgado del hito `regreso`: ESA es la bandera). Sin datos personales.
//
// ── LÍMITES CONOCIDOS ──────────────────────────────────────────────────────
//   · La plantilla N10 (caja cargada) espera la respuesta del cliente y la deja T-A5-59: el aviso va como texto con botón; fuera de la
//     ventana de 24 h lo gestiona el envío (cola/rechazo) como cualquier otro aviso sin plantilla.
//   · El «Ya lo atiendo» del supervisor contesta pero aún no marca atendida esta alerta en el tablero.
// ═══════════════════════════════════════════════════════════════════════════

/** Nivel reservado del claim `escalacion` para este aviso (1–2 cron, 3–5 reporte de llegada, 7 patio, 8 pregunta de estadía). */
export const NIVEL_AVISO_RESULTADO = 6;

const una = (t: string, n: number): string => t.replace(/\s+/g, ' ').trim().slice(0, n);
const detalle = (ciclo: number, estado: string, extra: Record<string, string | number | boolean | null> = {}) => ({ clase: 'resultado_descarga', estado, ciclo, ...extra });

export interface PuertosResultado extends Pick<PuertosConductor, 'reclamar' | 'cerrarAviso' | 'enviar' | 'destinatarios' | 'evento'> {
  eventos(tenantId: string, viajeIds: string[]): Promise<EventoPatioFila[]>;
  /** A37-S36-03: como `evento`, pero devuelve si quedó guardado. Sin él (puertos de prueba) se asume que sí. */
  guardar?(h: HitoFila, evento: Parameters<PuertosConductor['evento']>[1], detalle: Record<string, string | number | boolean | null>): Promise<boolean>;
}

export function puertosResultadoReales(): PuertosResultado {
  return { ...puertosReales(), eventos: leerEventosResultadoDescarga, guardar: registrarEventoConfirmado };
}

/** Escribe un renglón y dice si quedó: el estado «respondido» y la bandera de caja cargada NO se acusan como anotados si se perdieron. */
async function escribir(p: PuertosResultado, h: HitoFila, evento: Parameters<PuertosConductor['evento']>[1], d: Record<string, string | number | boolean | null>): Promise<boolean> {
  if (p.guardar) return p.guardar(h, evento, d);
  await p.evento(h, evento, d);
  return true;
}

export interface EstadoResultado {
  preguntado: boolean;
  respondido: OpcionResultadoDescarga | null;
  alertado: boolean;
  /** Cuántos destinatarios recibieron el aviso (0 = nadie: excepción para el tablero). */
  entregados: number;
}

/** Lo que dice la bitácora para esa salida de descarga y ciclo (los renglones ya vienen del más viejo al más nuevo). */
export function estadoResultado(eventos: readonly EventoPatioFila[], hitoId: string, ciclo: number): EstadoResultado {
  const e: EstadoResultado = { preguntado: false, respondido: null, alertado: false, entregados: 0 };
  for (const x of eventos) {
    if (x.hitoId !== hitoId || Number(x.detalle.ciclo ?? ciclo) !== ciclo) continue;
    switch (x.detalle.estado) {
      case 'preguntado': e.preguntado = true; break;
      case 'respondido': e.respondido = x.detalle.opcion as OpcionResultadoDescarga; break;
      case 'alertado': e.alertado = true; e.entregados = Number(x.detalle.entregados ?? 0); break;
    }
  }
  return e;
}

/** ¿El regreso de ese ciclo trae la bandera de caja cargada? Pura (la usan el tablero y las pruebas). */
export function regresoConCajaCargada(eventos: readonly EventoPatioFila[], hitoRegresoId: string): boolean {
  return eventos.some((x) => x.hitoId === hitoRegresoId && x.detalle.estado === 'caja_cargada');
}

/**
 * Tras registrar la salida de descarga: la pregunta, o `null` (apagado, ya preguntada, o la base falló: nunca rompe el acuse de la salida).
 */
export async function preguntarResultado(
  p: PuertosResultado, config: Pick<ConfigConductor, 'resultadoDescargaActivo'>, viaje: ViajeContexto, hito: HitoFila,
): Promise<Salida | null> {
  if (config.resultadoDescargaActivo !== true || hito.tipo !== 'salida_descarga') return null;
  try {
    const previo = estadoResultado(await p.eventos(viaje.tenantId, [viaje.id]), hito.id, hito.ciclo);
    if (previo.preguntado || previo.respondido) return null;
    await p.evento(hito, 'validacion', detalle(hito.ciclo, 'preguntado'));
    return preguntaResultadoDescarga(viaje);
  } catch (e) {
    logger.warn('conductor.resultado_descarga_pregunta_fallo', { viaje: viaje.id, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export function armarAvisoCajaCargada(v: Pick<ViajeContexto, 'id' | 'folio' | 'operadorNombre'>, opcion: Exclude<OpcionResultadoDescarga, 'completa'>): MensajeSaliente {
  const chofer = una(v.operadorNombre ?? 'El chofer', 60) || 'El chofer';
  const folio = v.folio || v.id.slice(0, 8);
  const que = opcion === 'no_recibida'
    ? 'no le recibieron la mercancía en el cliente y regresa a patio con la caja cargada'
    : 'regresa a patio con la caja cargada';
  return {
    texto: `Aviso para el supervisor: ${chofer} (viaje ${folio}) ${que}. Confírmalo para decidir qué sigue con la caja.`,
    botones: [{ id: `${PREFIJO_BOTON.jefeAtiendo}:${v.id}`, titulo: 'Ya lo atiendo' }],
    // N10 (caja cargada) espera al cliente y su entrada de catálogo la deja T-A5-59: fuera de ventana va la genérica de operación.
    plantilla: {
      nombre: 'aviso_operacion_v1',
      ...opcionesDeEnvio('aviso_operacion_v1', {
        cuerpo: parametrosAvisoOficina(chofer, opcion === 'no_recibida' ? `no le recibieron, caja cargada (${folio})` : `regresa con la caja cargada (${folio})`, `${appUrl()}/dashboard/agentes/conductores`),
      }),
    },
  };
}

export interface EntradaResultado {
  viaje: ViajeContexto;
  hitos: readonly HitoFila[];
  config: Pick<ConfigConductor, 'resultadoDescargaActivo'>;
  opcion: OpcionResultadoDescarga;
  via: 'boton' | 'texto';
  ahora: Date;
}

export interface SalidaResultado {
  mensajes: Salida[];
  /** `true` = la opción pide fijar el regreso con la bandera: `atender.ts` lo registra con la máquina de hitos. */
  fijarRegreso: boolean;
}

/**
 * La respuesta del chofer: la guarda y, si la caja regresa cargada, avisa al supervisor y marca el regreso. `null` = no es de este módulo
 * (texto sin pregunta abierta). Nunca lanza.
 */
export async function responderResultadoDescarga(p: PuertosResultado, x: EntradaResultado): Promise<SalidaResultado | null> {
  const { viaje: v, ahora } = x;
  const una_ = (mensajes: Salida[], fijarRegreso = false): SalidaResultado => ({ mensajes, fijarRegreso });
  try {
    const salida = x.hitos.find((h) => h.tipo === 'salida_descarga' && estaResuelto(h));
    if (!salida) return x.via === 'texto' ? null : una_([{ texto: 'Todavía no tengo anotada tu salida de la descarga. Avísame cuando termines. 📦' }]);
    const st = estadoResultado(await p.eventos(v.tenantId, [v.id]), salida.id, salida.ciclo);
    if (x.via === 'texto' && (!st.preguntado || st.respondido)) return null;
    if (x.config.resultadoDescargaActivo !== true) return x.via === 'texto' ? null : una_([{ texto: 'Ese aviso ya no está vigente. 👍' }]);
    const FALLO = una_([{ texto: 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏' }]);
    const regreso = x.hitos.find((h) => h.tipo === 'regreso');
    if (st.respondido) {
      // A37-S36-03: la respuesta ya quedó, pero si a una caja cargada le faltó la bandera del regreso o el aviso, el siguiente toque lo completa
      // (antes «respondido» bloqueaba el reintento y la alerta se perdía para siempre).
      const previa = st.respondido;
      if (previa === 'completa') return una_([{ texto: 'Ya tengo anotada tu respuesta sobre la descarga. 👍' }]);
      const eventos = await p.eventos(v.tenantId, [v.id]);
      const faltaBandera = !!regreso && !regresoConCajaCargada(eventos, regreso.id);
      if (st.alertado && !faltaBandera) return una_([{ texto: 'Ya tengo anotada tu respuesta sobre la descarga. 👍' }]);
      if (faltaBandera && !await escribir(p, regreso!, 'validacion', detalle(regreso!.ciclo, 'caja_cargada', { origen: previa }))) return FALLO;
      const avisado = st.alertado ? true : await avisarSupervisor(p, v, salida, previa, ahora);
      return una_([acuseResultadoDescarga(previa, avisado)], true);
    }

    // La bandera del regreso va ANTES de «respondido»: si «respondido» se pierde, el chofer reintenta; si se perdiera la bandera con
    // «respondido» ya puesto, el reintento ya no la pondría.
    if (x.opcion !== 'completa' && regreso && !await escribir(p, regreso, 'validacion', detalle(regreso.ciclo, 'caja_cargada', { origen: x.opcion }))) return FALLO;
    if (!await escribir(p, salida, 'validacion', detalle(salida.ciclo, 'respondido', { opcion: x.opcion, via: x.via, caja_cargada: x.opcion !== 'completa' }))) return FALLO;
    if (x.opcion === 'completa') return una_([acuseResultadoDescarga('completa', false)]);

    const avisado = await avisarSupervisor(p, v, salida, x.opcion, ahora);
    return una_([acuseResultadoDescarga(x.opcion, avisado)], true);
  } catch (err) {
    logger.error('conductor.resultado_descarga_respuesta_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return una_([{ texto: 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏' }]);
  }
}

/** Claim primero (un solo aviso por salida); devuelve si al menos un destinatario lo recibió (o quedó en cola). */
async function avisarSupervisor(
  p: PuertosResultado, v: ViajeContexto, h: HitoFila, opcion: Exclude<OpcionResultadoDescarga, 'completa'>, ahora: Date,
): Promise<boolean> {
  const claim: NuevoAviso = { tenantId: v.tenantId, viajeId: v.id, hitoId: h.id, operadorId: null, ciclo: h.ciclo, clase: 'escalacion', nivel: NIVEL_AVISO_RESULTADO };
  const gano = await p.reclamar(claim);
  if (gano !== 'ganado') return gano === 'perdido'; // un aviso previo ya salió (o va en camino)
  try {
    const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
    if (destinos.length === 0) {
      logger.warn('conductor.resultado_descarga_sin_destinatario', { viaje: v.id });
      await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
      await p.evento(h, 'validacion', detalle(h.ciclo, 'alertado', { destinatarios: 0, entregados: 0 }));
      return false;
    }
    const msg = armarAvisoCajaCargada(v, opcion);
    let entregados = 0;
    let canal: 'texto' | 'botones' | 'plantilla' = 'texto';
    let ultimoError = '';
    let encolados = 0;
    for (const d of destinos) {
      const r = await p.enviar(d.telefono, msg, 'conductor.resultado_descarga', v.tenantId, ahora);
      if (r.ok) { entregados++; canal = r.via; } else { ultimoError = r.mensaje; if (r.reintentable || r.encolado) encolados++; }
    }
    // Un rechazo reintentable YA quedó en `wa_outbox`: el claim se cierra «en cola» y NO se suelta (soltarlo duplicaría el aviso).
    const enCola = entregados === 0 && encolados === destinos.length;
    await p.cerrarAviso(claim, {
      ok: entregados > 0 || enCola, canal: entregados > 0 ? canal : enCola ? 'texto' : 'ninguno',
      motivo: entregados > 0 ? null : enCola ? 'en_cola_outbox' : ultimoError.slice(0, 200), ult4: destinos[0].telefono.slice(-4),
    });
    const llegaron = entregados > 0 || enCola;
    await p.evento(h, 'validacion', detalle(h.ciclo, 'alertado', { destinatarios: destinos.length, entregados: llegaron ? Math.max(entregados, 1) : 0 }));
    return llegaron;
  } catch (err) {
    logger.error('conductor.resultado_descarga_aviso_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'error_inesperado', ult4: null }).catch(() => undefined);
    return false;
  }
}
