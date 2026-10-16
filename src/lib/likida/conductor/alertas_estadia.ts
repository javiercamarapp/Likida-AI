import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import { parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { dentroDeVentana, type ConfigConductor } from './config';
import { calcularEstancias, excedeUmbral, hayUmbralDeEstadia, umbralDe, type Estancia } from './estadias_anden';
import { evaluarCompuertaDeViajes, puertosReales, type PuertosConductor, type NuevoAviso } from './ejecutor';
import { acuseEstadiaDescarga, horaYDiaMx, preguntaEstadiaDescarga, type RespuestaEstadia, type Salida } from './mensajes';
import { textoTiempo } from './planificador';
import type { ViajeContexto } from './repo';
import type { MensajeSaliente } from './solicitudes';
import { estaResuelto, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LA ALERTA POR EXCESO DE ESTADÍA — «lleva 3 h en el andén».
//
// Configurable por flota y por parada (`estadia_alerta_carga_min` /
// `estadia_alerta_descarga_min`; NULL = sin alerta, que es el default: un aviso por
// cada parada larga es ruido hasta que el tráfico lo pida). Mientras la unidad sigue
// en el andén y rebasa el umbral, el patio responsable de la terminal recibe UN aviso
// con la hora exacta de la llegada (la del mensaje del chofer).
//
//   · UN aviso por parada y ciclo: el claim `alerta_estadia` (nivel 1) sobre el hito
//     de LLEGADA es el candado — dos corridas solapadas mandan uno solo, y una
//     reentrega no repite.
//   · Mismo envío que todo lo demás: `enviarConFallback` (ventana 24 h → texto;
//     fuera → la plantilla genérica `aviso_operacion_v1`).
//   · Nunca fuera de la ventana horaria de la flota: una alerta nocturna espera a
//     que abra (no se reclama hasta entonces).
//   · Un rechazo reintentable libera el claim (se reintenta en la siguiente corrida);
//     uno definitivo lo deja cerrado con `ok = false` y el motivo a la vista.
//
// ── T-A5-45 (R17): LA DESCARGA INTERACTIVA ─────────────────────────────────
// Con `estadiaDescargaInteractiva` (apagada por omisión: el aviso de siempre) la estadía de DESCARGA no avisa directo al patio:
// al rebasar el umbral (el de la flota o el del CLIENTE: 120 general, 240 para un convenio de 4 h) le pregunta al chofer
// «¿ya inició la descarga?» con dos botones, y la respuesta decide:
//   · «no»            → aviso inmediato al supervisor con el contacto y los minutos (`responderEstadiaDescarga`, vía `atender.ts`).
//   · «sí»            → se espera el fin de descarga: el claim del aviso se cierra sin mandar nada.
//   · sin respuesta   → pasados `estadiaDescargaSinRespuestaMin` más, el cron avisa al supervisor (configurable).
// El MISMO claim `alerta_estadia` nivel 1 sobre la llegada es la única fuente de verdad de los tres caminos: quien llega primero lo gana
// y los demás ven «perdido», así nunca hay dos avisos ni un aviso después de un «sí». La pregunta tiene su propio claim
// (`escalacion`, nivel 8) y pasa por la compuerta «unidad detenida» (T-A5-36) y por la ventana horaria como todo mensaje proactivo.
// Sin migración (Ruling): ni claims nuevos ni columnas; el umbral por cliente vive en configuración.
// ═══════════════════════════════════════════════════════════════════════════

/** Nivel reservado (clase `escalacion`) para el claim de la pregunta «¿ya inició?»; el 7 es del patio de entrega (T-A5-44). */
export const NIVEL_PREGUNTA_ESTADIA = 8;

export interface ResultadoAlertasEstadia {
  /** T-A5-45: preguntas «¿ya inició la descarga?» enviadas al chofer en esta pasada. Ausente = ninguna. */
  preguntas?: number;

  revisadas: number;
  alertas: number;
  yaReclamadas: number;
  sinDestinatario: number;
  fueraDeVentana: number;
  /** T-A5-36: estancias cuyo aviso espera porque la compuerta «unidad detenida» no da la unidad por detenida (ni dentro del sitio). Ausente = ninguna. */
  compuertaMovimiento?: number;
  rechazosReintentables: number;
  fallos: string[];
}

/** El texto y la plantilla del aviso. Texto con la hora exacta; plantilla = la genérica de operación. */
/** T-A5-45: por qué se avisa a la descarga interactiva y con quién se reportó el chofer (dato de ejecución, nunca del repo). */
export interface ExtraAvisoEstadia { motivo?: 'no_inicio' | 'sin_respuesta'; contacto?: string | null }

export function armarAlertaEstadia(v: ViajeContexto, e: Estancia, umbralMin: number, ahora: Date, zona?: string, extra: ExtraAvisoEstadia = {}): MensajeSaliente {
  const chofer = (v.operadorNombre ?? 'El chofer').replace(/\s+/g, ' ').trim().slice(0, 60) || 'El chofer';
  const folio = v.folio || v.id.slice(0, 8);
  const lugar = e.lugar === 'carga' ? 'la carga' : 'la descarga';
  const sitio = ((e.lugar === 'carga' ? v.origen : v.destino) ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const llegada = e.llegada ? horaYDiaMx(new Date(e.llegada.en), ahora, zona) : 'hora desconocida';
  const duracion = textoTiempo(e.minutos ?? 0);
  const contacto = (extra.contacto ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const conContacto = contacto ? ` Se reportó con ${contacto}.` : '';
  const texto = extra.motivo
    ? `Estadía en la descarga: ${chofer} lleva ${duracion} en ${lugar}${sitio ? ` de ${sitio}` : ''} (viaje ${folio}) y ${extra.motivo === 'no_inicio' ? 'contestó que la descarga AÚN NO inicia' : 'no contestó si ya inició la descarga'}.${conContacto} Llegó a las ${llegada} (hora de su mensaje). Llámale o apóyalo con el cliente; está en el tablero.`
    : `Estadía larga: ${chofer} lleva ${duracion} en ${lugar}${sitio ? ` de ${sitio}` : ''} (viaje ${folio}). Llegó a las ${llegada} (hora de su mensaje) y no ha avisado su salida. Tu alerta está en ${textoTiempo(umbralMin)}. Revísalo en el tablero.`;
  const resumen = extra.motivo === 'no_inicio' ? `descarga sin iniciar, ${duracion} (${folio})`
    : extra.motivo === 'sin_respuesta' ? `sin respuesta, ${duracion} en descarga (${folio})`
    : `lleva ${duracion} en ${lugar} (${folio})`;
  return {
    texto,
    botones: [],
    plantilla: {
      nombre: 'aviso_operacion_v1',
      ...opcionesDeEnvio('aviso_operacion_v1', { cuerpo: parametrosAvisoOficina(chofer, resumen, `${appUrl()}/dashboard/agentes/conductores`) }),
    },
  };
}

const llave = (v: ViajeContexto, hitoLlegada: HitoFila): NuevoAviso => ({
  tenantId: v.tenantId, viajeId: v.id, hitoId: hitoLlegada.id, operadorId: null, ciclo: hitoLlegada.ciclo, clase: 'alerta_estadia', nivel: 1,
});

type PuertosAviso = Pick<PuertosConductor, 'reclamar' | 'cerrarAviso' | 'enviar' | 'destinatarios' | 'evento'>;

/**
 * El aviso al patio/supervisor: claim primero (UNO por parada y ciclo), envío con fallback y cierre del claim. Lo comparten el cron
 * (umbral cruzado o chofer sin respuesta) y la respuesta «no» del chofer. Nunca lanza.
 */
async function avisarEstadia(
  p: PuertosAviso, v: ViajeContexto, hl: HitoFila, e: Estancia, umbralMin: number, config: ConfigConductor, ahora: Date,
  r: ResultadoAlertasEstadia, extra: ExtraAvisoEstadia = {},
): Promise<'entregado' | 'en_cola' | 'fallo_envio' | 'perdido' | 'otro'> {
  try {
    const claim = llave(v, hl);
    const gano = await p.reclamar(claim);
    if (gano === 'perdido') { r.yaReclamadas++; return 'perdido'; }
    if (gano === 'fallo') { r.fallos.push(`reclamo estadía ${v.id}`); return 'otro'; }

    const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
    if (destinos.length === 0) {
      r.sinDestinatario++;
      r.fallos.push(`${v.folio ?? v.id}: no hay a quién avisar la estadía`);
      await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
      return 'otro';
    }
    const msg = armarAlertaEstadia(v, e, umbralMin, ahora, config.zonaHoraria, extra);
    let entregados = 0;
    let reintentables = 0;
    let ultimoError = '';
    let canal: 'texto' | 'botones' | 'plantilla' = 'texto';
    for (const d of destinos) {
      const envio = await p.enviar(d.telefono, msg, 'conductor.alerta_estadia', v.tenantId, ahora);
      if (envio.ok) { entregados++; canal = envio.via; } else { ultimoError = envio.mensaje; if (envio.reintentable) reintentables++; }
    }
    if (entregados === 0 && reintentables === destinos.length) {
      // Un rechazo reintentable (timeout, 429, 5xx) YA dejó el texto en `wa_outbox` (client.ts), que lo
      // entrega con su backoff. Soltar el claim aquí haría que la siguiente corrida lo mande otra vez y el
      // outbox entregue el primero: dos avisos. El claim se CIERRA como «en cola» y el outbox es quien reintenta.
      await p.cerrarAviso(claim, { ok: true, canal: 'texto', motivo: 'en_cola_outbox', ult4: destinos[0].telefono.slice(-4) });
      r.rechazosReintentables++;
      r.fallos.push(`estadía ${v.folio ?? v.id}: ${ultimoError} (queda en la cola de WhatsApp; no se reenvía)`);
      return 'en_cola';
    }
    await p.cerrarAviso(claim, { ok: entregados > 0, canal: entregados > 0 ? canal : 'ninguno', motivo: entregados > 0 ? null : ultimoError.slice(0, 200), ult4: destinos[0].telefono.slice(-4) });
    if (entregados > 0) {
      r.alertas++;
      await p.evento(hl, 'alerta_estadia', { lugar: e.lugar, minutos: e.minutos ?? 0, destinatarios: destinos.length, entregados, ...(extra.motivo ? { motivo: extra.motivo } : {}) });
    } else r.fallos.push(`estadía ${v.folio ?? v.id}: ${ultimoError}`);
    return entregados === 0 ? 'fallo_envio' : 'entregado';
  } catch (err) {
    r.fallos.push(`${v.folio ?? v.id}: ${err instanceof Error ? err.message : 'error inesperado'}`);
    logger.error('conductor.estadia_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return 'otro';
  }
}

/** La pregunta «¿ya inició la descarga?» al chofer (con respaldo de plantilla N07, aún sin entrada en el catálogo: la deja T-A5-59). */
export function armarPreguntaEstadia(v: ViajeContexto, e: Estancia): MensajeSaliente {
  const s: Salida = preguntaEstadiaDescarga(v, textoTiempo(e.minutos ?? 0));
  const folio = v.folio || v.id.slice(0, 8);
  return {
    texto: s.texto,
    botones: s.botones ?? [],
    // N07 (conductor_estadia_descarga_v1) todavía NO está en el catálogo ni aprobada por Meta: si Meta la rechaza (132001), la pregunta
    // queda sin entregar y el aviso al supervisor sale igual por «sin respuesta». No se usa `opcionesDeEnvio` (lanzaría fuera del catálogo).
    plantilla: { nombre: 'conductor_estadia_descarga_v1', idioma: 'es_MX', parametros: [(v.operadorNombre ?? 'chofer').split(' ')[0].slice(0, 40), folio, textoTiempo(e.minutos ?? 0)] },
  };
}

async function preguntarEstadia(
  p: PuertosAviso, v: ViajeContexto, hl: HitoFila, e: Estancia, ahora: Date, r: ResultadoAlertasEstadia,
): Promise<void> {
  const claim: NuevoAviso = { tenantId: v.tenantId, viajeId: v.id, hitoId: hl.id, operadorId: v.operadorId, ciclo: hl.ciclo, clase: 'escalacion', nivel: NIVEL_PREGUNTA_ESTADIA };
  try {
    const gano = await p.reclamar(claim);
    if (gano === 'perdido') return;
    if (gano === 'fallo') { r.fallos.push(`reclamo pregunta estadía ${v.id}`); return; }
    if (!v.operadorTelefono) {
      await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_telefono', ult4: null });
      r.fallos.push(`${v.folio ?? v.id}: el chofer no tiene teléfono para preguntarle por la descarga`);
      return;
    }
    const envio = await p.enviar(v.operadorTelefono, armarPreguntaEstadia(v, e), 'conductor.pregunta_estadia', v.tenantId, ahora);
    if (envio.ok) {
      await p.cerrarAviso(claim, { ok: true, canal: envio.via, motivo: null, ult4: v.operadorTelefono.slice(-4) });
      r.preguntas = (r.preguntas ?? 0) + 1;
      await p.evento(hl, 'alerta_estadia', { lugar: e.lugar, minutos: e.minutos ?? 0, fase: 'pregunta' });
    } else {
      // Reintentable = ya quedó en `wa_outbox` (no se suelta el claim: duplicaría la pregunta). Definitivo = cerrada sin ok.
      await p.cerrarAviso(claim, { ok: envio.reintentable, canal: envio.reintentable ? 'texto' : 'ninguno', motivo: envio.reintentable ? 'en_cola_outbox' : envio.mensaje.slice(0, 200), ult4: v.operadorTelefono.slice(-4) });
      r.fallos.push(`pregunta estadía ${v.folio ?? v.id}: ${envio.mensaje}`);
    }
  } catch (err) {
    r.fallos.push(`${v.folio ?? v.id}: ${err instanceof Error ? err.message : 'error inesperado'}`);
    logger.error('conductor.estadia_pregunta_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
  }
}

export async function correrAlertasEstadia(
  p: PuertosConductor, opts: { ahora?: Date; venceEn?: number } = {},
): Promise<ResultadoAlertasEstadia> {
  const ahora = opts.ahora ?? new Date();
  const r: ResultadoAlertasEstadia = { revisadas: 0, alertas: 0, yaReclamadas: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] };
  const viajes = await p.viajesActivos(400);
  if (viajes.length === 0) return r;
  const hitos = await p.hitosDe(viajes.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);

  const configs = new Map<string, ConfigConductor | null>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try { configs.set(t, await p.configDe(t)); } catch (e) {
      configs.set(t, null);
      logger.error('conductor.estadia_config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }
  const vacio = new Map<string, never>();
  let rechazosSeguidos = 0;
  let compuerta: ReturnType<typeof evaluarCompuertaDeViajes> | undefined;
  for (const v of viajes) {
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) break;
    const config = configs.get(v.tenantId);
    if (!config || !config.activo) continue;
    if (!hayUmbralDeEstadia(config)) continue;
    const hs = porViaje.get(v.id) ?? [];
    const enCurso = calcularEstancias(v, hs, ahora, { validaciones: vacio, evidencias: vacio }).filter((e) => excedeUmbral(e, config, v.clienteId));
    for (const e of enCurso) {
      r.revisadas++;
      if (!dentroDeVentana(config, ahora)) { r.fueraDeVentana++; continue; }
      const hl = hs.find((h) => h.id === e.llegada?.hitoId);
      if (!hl) continue;
      // T-A5-36: todo mensaje proactivo pasa por la compuerta «unidad detenida» ANTES del claim. Una unidad en el andén queda exenta
      // (dentro del sitio); si ya va rodando, el aviso espera a la siguiente pasada: ni se reclama ni se pierde.
      compuerta ??= evaluarCompuertaDeViajes(p, viajes, configs, ahora);
      const veredicto = (await compuerta).get(v.id);
      if (veredicto && !veredicto.permitido) { r.compuertaMovimiento = (r.compuertaMovimiento ?? 0) + 1; continue; }

      const umbral = umbralDe(config, e.lugar, v.clienteId) ?? 0;
      let extra: ExtraAvisoEstadia = {};
      if (e.lugar === 'descarga' && config.estadiaDescargaInteractiva === true) {
        // T-A5-45: primero se le pregunta al chofer; el supervisor solo se entera si dice «no» (otro camino) o no contesta a tiempo.
        const gracia = config.estadiaDescargaSinRespuestaMin ?? 30;
        if ((e.minutos ?? 0) < umbral + gracia) { await preguntarEstadia(p, v, hl, e, ahora, r); continue; }
        extra = { motivo: 'sin_respuesta', contacto: hl.contactoNombre };
      }
      const res = await avisarEstadia(p, v, hl, e, umbral, config, ahora, r, extra);
      if (res === 'en_cola') rechazosSeguidos++;
      else if (res === 'entregado' || res === 'fallo_envio') rechazosSeguidos = 0;
      if (rechazosSeguidos >= 5) {
        logger.error('conductor.estadia_rechazo_masivo', { rechazosSeguidos });
        return r;
      }
    }
  }
  return r;
}

// ── La respuesta del chofer al «¿ya inició?» ────────────────────────────────

export type PuertosEstadia = PuertosAviso;
export const puertosEstadiaReales = (): PuertosEstadia => puertosReales();

export interface EntradaRespuestaEstadia {
  viaje: ViajeContexto;
  hitos: readonly HitoFila[];
  config: ConfigConductor;
  respuesta: RespuestaEstadia;
  ahora: Date;
}

/**
 * «no» → aviso al supervisor YA (contacto y minutos); «sí» → se cierra el claim del aviso sin mandar nada y se espera el fin de descarga.
 * Un claim ya tomado (aviso enviado o respuesta previa) no se repite. Devuelve lo que se le contesta al chofer; nunca lanza.
 */
export async function responderEstadiaDescarga(p: PuertosEstadia, x: EntradaRespuestaEstadia): Promise<Salida[]> {
  const { viaje: v, config, ahora } = x;
  try {
    if (config.estadiaDescargaInteractiva !== true) return [{ texto: 'Ese aviso ya no está vigente. 👍' }];
    const hl = x.hitos.find((h) => h.tipo === 'llegada_descarga' && estaResuelto(h));
    const e = hl ? calcularEstancias(v, x.hitos, ahora, { validaciones: new Map(), evidencias: new Map() }).find((z) => z.lugar === 'descarga') : undefined;
    if (!hl || !e) return [{ texto: 'Todavía no tengo tu llegada a descargar anotada. Avísame cuando llegues. 📍' }];
    if (e.fase !== 'en_curso') return [{ texto: 'Ya tengo anotada tu salida de la descarga. 👍' }];

    if (x.respuesta === 'si') {
      const claim = llave(v, hl);
      const gano = await p.reclamar(claim);
      if (gano === 'ganado') {
        await p.cerrarAviso(claim, { ok: true, canal: 'ninguno', motivo: 'chofer_inicio_descarga', ult4: null });
        await p.evento(hl, 'alerta_estadia', { lugar: 'descarga', minutos: e.minutos ?? 0, fase: 'respuesta_si' });
      } else if (gano === 'fallo') {
        return [{ texto: 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏' }];
      }
      return [acuseEstadiaDescarga('si', false)];
    }

    const r: ResultadoAlertasEstadia = { revisadas: 1, alertas: 0, yaReclamadas: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] };
    const res = await avisarEstadia(p, v, hl, e, umbralDe(config, 'descarga', v.clienteId) ?? 0, config, ahora, r, { motivo: 'no_inicio', contacto: hl.contactoNombre });
    return [acuseEstadiaDescarga('no', res === 'entregado' || res === 'en_cola')];
  } catch (err) {
    logger.error('conductor.estadia_respuesta_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return [{ texto: 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏' }];
  }
}
