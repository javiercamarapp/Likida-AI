// ═══════════════════════════════════════════════════════════════════════════
// EL SERVICIO DEL VIGÍA — la orquestación de punta a punta.
//
//   atenderMensajeCliente    el webhook: un mensaje de un CLIENTE autorizado
//   aprobarMensaje / rechazarMensaje / tomarConversacion / devolverConversacion /
//   responderComoHumano / cerrarConversacion    los botones del gerente y el tablero
//   barridoVigia             el cron: SLA, escalera por niveles, atorados, retención
//   atenderDecisionVigia     el botón de WhatsApp (vig_ok / vig_no / vig_tomo)
//
// ── POR QUÉ PASA POR AQUÍ Y NO POR EL PIPELINE DEL CHOFER ───────────────────
// Un cliente no es un operador: no tiene viaje que cerrar, ni fotos de tickets,
// ni liquidación. Comparte con el resto de Likida solo el webhook (idempotencia
// por `waMessageId`, kill switch global, ventana de 24 h). El processor llama a
// `atenderMensajeCliente` en el punto donde antes decía «no te tengo registrado»,
// y SOLO responde eso si esta función contesta `no_es_cliente`.
//
// ── QUÉ GARANTIZA ───────────────────────────────────────────────────────────
//   · el tenant y el cliente salen del CONTACTO autorizado, nunca del texto;
//   · cada mensaje del cliente tiene a lo más UN borrador del agente (la base lo
//     impone) y a lo más UN envío (reclamo condicional de estado);
//   · una respuesta del agente nace pendiente de aprobación; solo sale sola en el
//     modo de la flota y cuando la política (politica.ts) lo permite;
//   · lo que no se pudo contestar con un dato real escala; lo que quedó sin
//     respuesta pasado el SLA escala; ambos con bitácora y sin repetirse;
//   · después de guardar el mensaje del cliente, nada de lo que falle lo pierde:
//     el reloj del SLA ya corre y el cron lo escalará a un humano.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { normalizarTelefonoWa } from '@/lib/likida/wa_ventana';
import { sendDocument } from '@/lib/meta/client';
import { enviarAlCliente, MAX_TEXTO_AL_CLIENTE } from './enviar';
import { nombreDeAdjunto } from './adjuntos';
import { avisarAprobacion, avisarEscalamiento, interpretarBoton, type DecisionBoton } from './avisos';
import { clasificar } from './clasificador';
import { esSpam, limpiarTexto } from './entrada';
import { DIAS_CICLO_INACTIVO, evaluarEscalamiento, minutosEsperando, type AccionEscalamiento } from './escalamiento';
import { resolverViaje, type ResumenViaje } from './estatus_viaje';
import { evaluarMolestia } from './molestia';
import { decidirEnvio } from './politica';
import { claveCorreo, debeRespaldarPorCorreo, hashCorreo, reintentarCorreosVencidos, respaldarPorCorreo, unirDestinatarios } from './respaldo_correo';
import { pulirBorrador, redactarBorrador, type ViajeParaRedactar } from './redactor';
import { elegirRespuestaRapida } from './respuestas_rapidas';
import type { DepsVigia, GuardaConversacion, RepoVigia } from './puertos';
import { configParaCliente } from './tipos';
import type {
  AdjuntoRef, Clasificacion, ConfigVigia, Contacto, Conversacion, DatosAvisoCorreo, DestinatarioAviso, MensajeVigia, MotivoEscalamiento, NivelDirector,
} from './tipos';

export interface MensajeEntrante {
  from: string;
  type: 'text' | 'image' | 'document' | 'location' | 'audio' | 'other';
  text?: string;
  waMessageId?: string;
  timestampMs?: number;
}

export type ResultadoEntrante = 'no_es_cliente' | 'atendido' | 'reintentar';

export function hashTelefono(telefono: string): string {
  return createHash('sha256').update(normalizarTelefonoWa(telefono)).digest('hex');
}

const TIPOS: Record<MensajeEntrante['type'], string> = {
  text: 'texto', image: 'imagen', document: 'documento', location: 'ubicacion', audio: 'audio', other: 'otro',
};

const ahoraDe = (d: DepsVigia): Date => (d.ahora ? d.ahora() : new Date());

const MENSAJE_BAJA = 'Listo: ya no te escribiremos por este medio. Si más adelante quieres volver a recibir mensajes, pídeselo a tu ejecutivo en la flota. Gracias.';

// ═══════════════════════════════════════════════════════════════════════════
// 1. EL MENSAJE DE UN CLIENTE
// ═══════════════════════════════════════════════════════════════════════════

export async function atenderMensajeCliente(msg: MensajeEntrante, deps: DepsVigia): Promise<ResultadoEntrante> {
  const { repo } = deps;
  const ahora = ahoraDe(deps);

  // ── ¿Es un cliente autorizado? ───────────────────────────────────────────
  // Si la búsqueda FALLA (la base, o una migración 0400 aún sin aplicar), se devuelve
  // `no_es_cliente`: el número cae a la regla de siempre («no te tengo registrado») en
  // vez de quedarse el webhook reintentando para siempre. Se loguea como error: es
  // una alerta, no un caso normal.
  let contacto: Contacto | null;
  try {
    contacto = await repo.contactoPorTelefono(normalizarTelefonoWa(msg.from));
  } catch (e) {
    logger.error('vigia.contacto_no_resuelto', { err: e instanceof Error ? e.message : String(e) });
    return 'no_es_cliente';
  }
  if (!contacto) return 'no_es_cliente';

  // Ya es un cliente conocido: desde aquí, si la base falla, se REINTENTA (no se le
  // dice «no te tengo registrado» a quien sí tenemos).
  let config: ConfigVigia;
  try {
    config = await repo.config(contacto.tenantId);
    // 0484: un cliente con grupo crítico se atiende con el plazo corto (la lectura nunca lanza hacia aquí).
    config = configParaCliente(config, await repo.clienteCritico(contacto.tenantId, contacto.clienteId).catch(() => false));
  } catch (e) {
    logger.error('vigia.config_no_leida', { tenant: contacto.tenantId, err: e instanceof Error ? e.message : String(e) });
    return 'reintentar';
  }

  // El contacto es de la allowlist, pero su flota apagó el agente, o él pidió la
  // baja: no se le contesta y TAMPOCO se le dice «no te tengo registrado» (sí lo
  // tenemos). Se calla y queda en el log.
  if (!config.habilitado || contacto.estado !== 'activo') {
    logger.info('vigia.contacto_sin_atencion', { tenant: contacto.tenantId, contacto: contacto.id, habilitado: config.habilitado, estado: contacto.estado });
    return 'atendido';
  }

  const tenantId = contacto.tenantId;
  const tipo = TIPOS[msg.type] ?? 'otro';
  const texto = msg.type === 'text' ? limpiarTexto(msg.text) : limpiarTexto(msg.text ?? '');
  const momento = msg.timestampMs && Number.isFinite(msg.timestampMs) ? new Date(msg.timestampMs) : ahora;

  let recibido;
  try {
    recibido = await repo.recibir({ tenantId, contactoId: contacto.id, wamid: msg.waMessageId ?? null, tipo, texto, ahora: momento });
  } catch (e) {
    logger.error('vigia.recibir_fallo', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return 'reintentar';
  }
  // Meta reentregó el mismo mensaje: ya se procesó, no se duplica nada.
  if (recibido.duplicado) return 'atendido';

  // ── Desde aquí el mensaje YA está guardado y el reloj del SLA corre ──────
  try {
    await procesarEntrante({ msg, tipo, texto, tenantId, contacto, config, recibido, ahora }, deps);
  } catch (e) {
    logger.error('vigia.procesar_fallo', { tenant: tenantId, conversacion: recibido.conversacionId, err: e instanceof Error ? e.message : String(e) });
    await escalarPorFallo(tenantId, recibido.conversacionId, contacto, config, deps);
  }
  return 'atendido';
}

interface ContextoEntrante {
  msg: MensajeEntrante;
  tipo: string;
  texto: string;
  tenantId: string;
  contacto: Contacto;
  config: ConfigVigia;
  recibido: { mensajeId: string; conversacionId: string; duplicado: boolean };
  ahora: Date;
}

async function procesarEntrante(c: ContextoEntrante, deps: DepsVigia): Promise<void> {
  const { repo } = deps;
  const { tenantId, contacto, config, recibido, ahora } = c;

  const conv = await repo.conversacion(tenantId, recibido.conversacionId);
  if (!conv) throw new Error('conversación inexistente tras recibir');
  const inicioCiclo = conv.sinRespuestaDesde ?? ahora.toISOString();

  // ── SPAM: ráfagas y repeticiones no abren consultas ni avisos ───────────
  const recientes = await repo.entrantesRecientes(tenantId, conv.id, new Date(ahora.getTime() - 10 * 60_000), 25);
  // Solo cuentan los mensajes SIN responder: quien repite la misma pregunta cada vez que
  // se le contesta (pregunta, respuesta, otra vez la pregunta) no es spam.
  const sinResponder = recientes.slice(-Math.max(1, conv.entradasSinRespuesta));
  const spam = esSpam(
    sinResponder.map((m) => ({ texto: m.texto ?? '', en: Date.parse(m.creadoEn) })),
    conv.entradasSinRespuesta, ahora.getTime(),
  );
  if (spam) {
    // UN registro por ciclo de espera, no uno por mensaje de spam.
    await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'spam', clave: `${conv.id}:spam:${Date.parse(inicioCiclo)}`, detalle: { motivo: spam } });
    return;
  }

  // ── Un humano lleva el hilo: el agente solo registra ────────────────────
  if (conv.control === 'humano') {
    await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'entrante', detalle: { control: 'humano' } });
    return;
  }

  // ── Clasificación ───────────────────────────────────────────────────────
  let cl: Clasificacion & { textoLimpio?: string };
  if (c.tipo !== 'texto') {
    // Una foto, un audio o un pin del cliente: el agente no los lee. Una persona los ve.
    cl = { intencion: 'otro', secundarias: [], confianza: 0, clasificador: 'ninguno', senales: ['no_texto'] };
  } else {
    cl = await clasificar(c.texto, deps.modelo, tenantId);
  }
  await repo.anotarClasificacion(tenantId, recibido.mensajeId, cl);
  await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'entrante', detalle: { intencion: cl.intencion, clasificador: cl.clasificador } });
  if (cl.senales.includes('inyeccion')) {
    await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'inyeccion', clave: `${recibido.mensajeId}:inyeccion` });
  }

  // ── BAJA: el opt-out se registra PRIMERO y se acusa después ─────────────
  if (cl.intencion === 'baja') {
    await repo.registrarOptOut(tenantId, contacto.id, ahora);
    await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'optout', destinatarioHash: hashTelefono(contacto.telefono) });
    await repo.cerrarConversacion(tenantId, conv.id, ahora);
    const nombreFlota = await repo.nombreFlota(tenantId);
    const enviarCliente = deps.enviarCliente ?? enviarAlCliente;
    const r = await enviarCliente({
      tenantId, contacto: { ...contacto, estado: 'baja', optoutEn: ahora.toISOString() },
      texto: MENSAJE_BAJA, nombreFlota, agenteHabilitado: config.habilitado,
    }, deps.enviar, { confirmacionDeBaja: true });
    if (!r.ok) logger.warn('vigia.acuse_baja_no_enviado', { tenant: tenantId, motivo: r.motivo });
    return;
  }

  // ── Molestia (lenguaje + insistencia + tiempo) ──────────────────────────
  const espera = minutosEsperando(conv.sinRespuestaDesde, ahora.getTime());
  const molestia = evaluarMolestia({
    texto: c.texto, intencion: cl.intencion, entradasSinRespuesta: conv.entradasSinRespuesta,
    minutosEsperando: espera, slaRespuestaMin: config.slaRespuestaMin,
  });
  const convActual: Conversacion = { ...conv };
  if (molestia.nivel > conv.molestiaNivel) {
    await repo.actualizarConversacion(tenantId, conv.id, {
      molestiaNivel: molestia.nivel, molestiaMotivos: molestia.motivos, molestiaEn: ahora.toISOString(),
    });
    convActual.molestiaNivel = molestia.nivel;
    convActual.molestiaMotivos = molestia.motivos;
    convActual.molestiaEn = ahora.toISOString();
    if (molestia.nivel >= 2) {
      await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'molestia', nivel: molestia.nivel, detalle: { motivos: molestia.motivos, puntos: molestia.puntos } });
    }
  }

  // ── Viaje: SOLO entre los viajes en curso de ESTE cliente ───────────────
  let viaje: ViajeParaRedactar = { tipo: 'ninguno' };
  const senales = [...cl.senales];
  let viajeEnFoco: string | null = conv.viajeId;
  const pideDato = ['ubicacion', 'eta', 'documentos', 'factura_pod'].includes(cl.intencion);
  if (pideDato) {
    const viajes: ResumenViaje[] = await repo.estatus.viajesEnCurso({ tenantId, clienteId: contacto.clienteId });
    const res = resolverViaje(c.texto, viajes, conv.viajeId);
    if (res.tipo === 'uno') {
      const est = await repo.estatus.estatus({ tenantId, clienteId: contacto.clienteId, viajeId: res.viajeId });
      viaje = est ? { tipo: 'uno', estatus: est } : { tipo: 'ninguno' };
      viajeEnFoco = est ? est.viajeId : null;
    } else if (res.tipo === 'ambiguo') {
      viaje = { tipo: 'ambiguo', viajes: res.viajes };
    } else if (res.tipo === 'folio_no_encontrado') {
      viaje = { tipo: 'folio_no_encontrado' };
      senales.push('folio_ajeno');
      // Ni el folio ni su dueño se anotan: solo que alguien preguntó por uno que no es suyo.
      await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'otro_cliente', clave: `${recibido.mensajeId}:folio_ajeno` });
    }
    if (viajeEnFoco !== conv.viajeId) await repo.actualizarConversacion(tenantId, conv.id, { viajeId: viajeEnFoco });
  }

  // ── Borrador con datos reales (o con «lo consulto») ─────────────────────
  const [nombreFlota, nombreCliente] = await Promise.all([repo.nombreFlota(tenantId), repo.nombreCliente(tenantId, contacto.clienteId)]);
  // 0647: lo que el Vigía no entendió, pero se parece a una pregunta cuya respuesta el gerente ya aprobó. Si leerlas falla, el
  // borrador sale como siempre: una respuesta rápida es un atajo, nunca un requisito para atender al cliente.
  let respuestaRapida: ReturnType<typeof elegirRespuestaRapida> = null;
  if (cl.intencion === 'otro' && c.tipo === 'texto' && !senales.includes('inyeccion')) {
    try { respuestaRapida = elegirRespuestaRapida(c.texto, await repo.respuestasRapidas(tenantId)); }
    catch (e) { logger.warn('vigia.respuestas_rapidas_no_leidas', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) }); }
  }
  let borrador = redactarBorrador({
    clasificacion: { intencion: cl.intencion, secundarias: cl.secundarias, senales },
    nombreContacto: contacto.nombre, nombreFlota, viaje, ahora,
    primerContacto: !contacto.avisoPrivacidadEn, avisoPrivacidadUrl: config.avisoPrivacidadUrl ?? `${appUrl()}/privacidad`,
    respuestaRapida,
  });
  const folio = viaje.tipo === 'uno' ? viaje.estatus.folio : null;
  const pulido = await pulirBorrador(borrador, c.texto, folio, deps.pulir, tenantId);
  borrador = pulido.borrador;
  if (pulido.motivoDescartado) logger.info('vigia.pulido_descartado', { tenant: tenantId, motivo: pulido.motivoDescartado });

  // ── Política: ¿sale sola o la aprueba el gerente? ───────────────────────
  const aprobaciones = await repo.aprobacionesSinEditar(tenantId, cl.intencion);
  const decision = decidirEnvio({
    config, clasificacion: { intencion: cl.intencion, confianza: cl.confianza, senales },
    borrador, conversacion: convActual, aprobacionesSinEditar: aprobaciones,
  });
  if (decision.accion === 'ninguna') return;

  // ¿Ya hay otra respuesta esperando al gerente en este hilo? Entonces el cliente que escribe varias
  // veces seguidas no le dispara un aviso por cada mensaje: ya fue avisado y el tablero las junta.
  const hayPendientePrevio = (await repo.pendientesDeHilo(tenantId, conv.id)).length > 0;
  const saliente = await repo.crearSaliente(tenantId, {
    conversacionId: conv.id, respuestaA: recibido.mensajeId, autor: 'agente', texto: borrador.texto,
    estado: decision.accion === 'autoenviar' ? 'aprobado' : 'pendiente_aprobacion',
    intencion: cl.intencion, riesgo: borrador.riesgo, datosRespaldo: borrador.respaldo, senales,
    autoenviado: decision.accion === 'autoenviar', aprobadoPor: null,
  });
  // Otra pasada (reintento, carrera) ya redactó la respuesta de este mensaje.
  if (!saliente.creado) return;
  if (borrador.origen === 'respuesta_rapida' && respuestaRapida) await repo.usarRespuestaRapida(tenantId, respuestaRapida.id).catch(() => {});
  await repo.evento(tenantId, {
    conversacionId: conv.id, tipo: 'borrador',
    detalle: { intencion: cl.intencion, riesgo: borrador.riesgo, decision: decision.motivo, faltantes: borrador.faltantes, tareas: borrador.tareas, origen: borrador.origen, ...(respuestaRapida ? { respuestaRapidaId: respuestaRapida.id } : {}) },
  });

  // ── Lo que falta o lo que pide humano: ESCALA (spec: «consultará y escala») ─
  let disparo: Extract<MotivoEscalamiento, 'pide_humano' | 'sin_dato' | 'folio_ajeno'> | null = null;
  if (senales.includes('folio_ajeno')) disparo = 'folio_ajeno';
  else if (cl.intencion === 'pide_humano') disparo = 'pide_humano';
  else if (borrador.faltantes.length > 0 || borrador.requiereHumano) disparo = 'sin_dato';
  if (disparo === 'sin_dato') {
    await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'sin_dato', clave: `${recibido.mensajeId}:sin_dato`, detalle: { faltantes: borrador.faltantes } });
  }

  const accion = evaluarEscalamiento({
    conversacion: { ...convActual, id: conv.id, estado: 'activa', sinRespuestaDesde: conv.sinRespuestaDesde ?? ahora.toISOString() },
    config, ahoraMs: ahora.getTime(), disparoInmediato: disparo,
  });

  if (decision.accion === 'autoenviar') {
    await enviarSaliente({ tenantId, mensajeId: saliente.id, texto: borrador.texto, contacto, config, conversacionId: conv.id, nombreFlota, autoenviado: true, adjuntos: [] }, deps);
    if (accion) await ejecutarEscalamiento(accion, { tenantId, conv: convActual, contacto, config, nombreCliente: nombreCliente ?? contacto.nombre }, deps);
    return;
  }

  if (hayPendientePrevio && decision.accion === 'aprobar') {
    // Ya se le avisó por un mensaje anterior de este hilo: este borrador queda en el tablero.
    if (accion && accion.nivel === 2) await ejecutarEscalamiento(accion, { tenantId, conv: convActual, contacto, config, nombreCliente: nombreCliente ?? contacto.nombre }, deps);
    else if (accion) await ejecutarEscalamiento(accion, { tenantId, conv: convActual, contacto, config, nombreCliente: nombreCliente ?? contacto.nombre }, deps, { enviar: false });
    return;
  }

  // Aprobación: el aviso al gerente YA es su alerta de nivel 1; si además corresponde
  // escalar a ese mismo nivel, solo se registra (no se le manda un segundo mensaje igual).
  const gerente = await repo.destinatarioNivel(tenantId, contacto, 1);
  if (!gerente) {
    await repo.evento(tenantId, { conversacionId: conv.id, tipo: 'sin_destinatario', clave: `${recibido.mensajeId}:sin_destinatario`, nivel: 1 });
    return;
  }
  const advertencia = advertenciaDeBorrador(borrador, senales);
  const r = await avisarAprobacion({
    tenantId, telefonoGerente: gerente.telefono, mensajeId: saliente.id, nombreCliente: nombreCliente ?? contacto.nombre ?? 'Un cliente',
    mensajeCliente: c.tipo === 'texto' ? c.texto : `(${c.tipo}: el cliente mandó un archivo)`, borrador: borrador.texto, advertencia,
  }, deps.enviar);
  if (r.ok) await repo.marcarAvisoGerente(tenantId, saliente.id, ahora);
  else logger.warn('vigia.aviso_aprobacion_fallo', { tenant: tenantId, motivo: r.motivo });
  if (accion) {
    await ejecutarEscalamiento(accion, { tenantId, conv: convActual, contacto, config, nombreCliente: nombreCliente ?? contacto.nombre }, deps, { enviar: accion.nivel !== 1 || !r.ok });
  }
}

/**
 * Si algo falló DESPUÉS de guardar el mensaje (la base de viajes, el modelo, el
 * aviso), el cliente no se queda esperando al SLA: se le avisa al gerente ya.
 * Todo con su propia red: si ni esto puede, el cron lo recoge por el reloj.
 */
async function escalarPorFallo(tenantId: string, conversacionId: string, contacto: Contacto, config: ConfigVigia, deps: DepsVigia): Promise<void> {
  try {
    const conv = await deps.repo.conversacion(tenantId, conversacionId);
    if (!conv) return;
    await deps.repo.evento(tenantId, { conversacionId, tipo: 'sin_dato', detalle: { causa: 'fallo_interno' } });
    const accion = evaluarEscalamiento({ conversacion: conv, config, ahoraMs: ahoraDe(deps).getTime(), disparoInmediato: 'sin_dato' });
    if (!accion) return;
    const nombre = await deps.repo.nombreCliente(tenantId, contacto.clienteId).catch(() => null);
    await ejecutarEscalamiento(accion, { tenantId, conv, contacto, config, nombreCliente: nombre ?? contacto.nombre }, deps);
  } catch (e) {
    logger.error('vigia.escalar_por_fallo_fallo', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
  }
}

function advertenciaDeBorrador(b: { faltantes: string[]; requiereHumano: boolean; adjuntos?: Array<AdjuntoRef['clave']>; origen?: string }, senales: string[]): string | null {
  const partes: string[] = [];
  if (b.origen === 'respuesta_rapida') partes.push('es una respuesta rápida que tú aprobaste para una pregunta parecida: revisa que conteste lo que preguntó el cliente');
  if (b.adjuntos && b.adjuntos.length > 0) partes.push(`adjuntará: ${b.adjuntos.map(nombreDeAdjunto).join(', ')} (solo si la ventana de 24 h del cliente sigue abierta)`);
  if (senales.includes('inyeccion')) partes.push('el mensaje del cliente trae instrucciones raras; revisa bien antes de enviar');
  if (senales.includes('folio_ajeno')) partes.push('preguntó por un folio que no es suyo');
  if (senales.includes('no_texto')) partes.push('mandó un archivo que el Vigía no lee');
  if (b.faltantes.length > 0) partes.push(`falta información real: ${b.faltantes.join(', ')}`);
  if (b.requiereHumano && partes.length === 0) partes.push('este caso lo debe atender una persona');
  return partes.length > 0 ? partes.join('; ') : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ENVIAR UNA RESPUESTA YA APROBADA (o autoenviada)
// ═══════════════════════════════════════════════════════════════════════════

interface EntradaEnviarSaliente {
  tenantId: string;
  mensajeId: string;
  texto: string;
  contacto: Contacto;
  config: ConfigVigia;
  conversacionId: string;
  nombreFlota: string;
  autoenviado: boolean;
  /** Archivos que salen JUNTO con el texto, si la ventana lo permite. */
  adjuntos: AdjuntoRef[];
}

export type ResultadoSalida = { ok: true; via: 'texto' | 'botones' | 'plantilla' } | { ok: false; motivo: string };

async function enviarSaliente(e: EntradaEnviarSaliente, deps: DepsVigia): Promise<ResultadoSalida> {
  const { repo } = deps;
  const ahora = ahoraDe(deps);
  const enviarCliente = deps.enviarCliente ?? enviarAlCliente;
  const r = await enviarCliente({
    tenantId: e.tenantId, contacto: e.contacto, texto: e.texto, nombreFlota: e.nombreFlota, agenteHabilitado: e.config.habilitado,
  }, deps.enviar);
  if (r.ok) {
    await repo.marcarEnviado(e.tenantId, e.mensajeId, { via: r.via, wamid: r.id, ahora });
    await repo.marcarRespondida(e.tenantId, e.conversacionId, ahora);
    if (!e.contacto.avisoPrivacidadEn) await repo.marcarAvisoPrivacidad(e.tenantId, e.contacto.id, ahora);
    await repo.evento(e.tenantId, { conversacionId: e.conversacionId, tipo: e.autoenviado ? 'autoenviado' : 'enviado', detalle: { via: r.via, ventana: r.ventana } });
    // Los archivos son un EXTRA: que fallen no deshace el texto que ya salió (queda a la vista del gerente).
    if (e.adjuntos.length > 0) {
      await entregarAdjuntos(e, r.via, deps).catch((err) => logger.error('vigia.adjuntos_fallo', { tenant: e.tenantId, err: err instanceof Error ? err.message : String(err) }));
    }
    return { ok: true, via: r.via };
  }
  await repo.marcarFallido(e.tenantId, e.mensajeId, `${r.motivo}: ${r.mensaje}`.slice(0, 300));
  await repo.evento(e.tenantId, { conversacionId: e.conversacionId, tipo: 'fallo_envio', detalle: { motivo: r.motivo, reintentable: r.reintentable } });
  return { ok: false, motivo: r.mensaje };
}

/**
 * Los archivos que acompañan a la respuesta. Reglas (ver adjuntos.ts): solo dentro de la ventana de 24 h —si el texto
 * salió como PLANTILLA, el archivo queda pendiente a la vista del gerente—, el archivo se busca por (flota, cliente,
 * viaje) con el cliente del CONTACTO, y cada resultado queda en la bitácora sin teléfono ni ruta.
 */
async function entregarAdjuntos(e: EntradaEnviarSaliente, via: 'texto' | 'botones' | 'plantilla', deps: DepsVigia): Promise<void> {
  const { repo } = deps;
  const base = { conversacionId: e.conversacionId, destinatarioHash: hashTelefono(e.contacto.telefono) };
  for (const adj of e.adjuntos) {
    const clave = `${e.mensajeId}:adjunto:${adj.clave}`;
    if (via === 'plantilla') {
      await repo.evento(e.tenantId, { ...base, tipo: 'adjunto_pendiente', clave, detalle: { adjunto: adj.clave, motivo: 'ventana_cerrada' } });
      continue;
    }
    const archivo = await repo.archivoAdjunto({ tenantId: e.tenantId, clienteId: e.contacto.clienteId, viajeId: adj.viajeId, clave: adj.clave });
    if (!archivo) {
      await repo.evento(e.tenantId, { ...base, tipo: 'adjunto_fallo', detalle: { adjunto: adj.clave, motivo: 'archivo_no_disponible' } });
      continue;
    }
    const mandar = deps.enviarDocumento ?? sendDocument;
    const r = await mandar(e.contacto.telefono, archivo.url, archivo.nombre, archivo.pie);
    if (r.ok) await repo.evento(e.tenantId, { ...base, tipo: 'adjunto_enviado', clave, detalle: { adjunto: adj.clave } });
    else await repo.evento(e.tenantId, { ...base, tipo: 'adjunto_fallo', detalle: { adjunto: adj.clave, motivo: 'rechazado', codigo: r.codigo ?? null } });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ESCALAMIENTO (nivel 1 = responsable, nivel 2 = dueño), CON BITÁCORA
// ═══════════════════════════════════════════════════════════════════════════

interface ContextoEscalamiento {
  tenantId: string;
  conv: Pick<Conversacion, 'id' | 'sinRespuestaDesde'>;
  contacto: Contacto;
  config: ConfigVigia;
  nombreCliente: string | null;
}

/** `obsoleto`: el hilo ya no esperaba (o cambió de ciclo) cuando el barrido llegó a escribir; no se avisa ni se toca. */
export type ResultadoEscalamiento = 'avisado' | 'registrado' | 'sin_destinatario' | 'duplicado' | 'fallo_envio' | 'obsoleto';

async function ejecutarEscalamiento(
  a: AccionEscalamiento, c: ContextoEscalamiento, deps: DepsVigia, opciones: { enviar: boolean; guardaCiclo?: boolean } = { enviar: true },
): Promise<ResultadoEscalamiento> {
  const { repo } = deps;
  const ahora = ahoraDe(deps);

  // `guardaCiclo` (solo el barrido; la ruta en caliente actúa sobre el hilo que acaba de tocar y a veces escala TRAS responder): el barrido lee las filas UNA vez y escribe después de varias idas a la base: si mientras tanto el gerente contestó
  // (`marcarRespondida` deja `sin_respuesta_desde` en null) o el cliente abrió otro ciclo, esa lectura es vieja. Toda
  // escritura va condicionada al mismo ciclo de espera que se leyó; si ya no coincide, no se avisa por algo ya atendido
  // ni se deja un nivel heredado que silenciaría el siguiente ciclo.
  if (opciones.guardaCiclo && !c.conv.sinRespuestaDesde) return 'obsoleto';
  const guarda = (nivelMenorA: number): GuardaConversacion | undefined =>
    (opciones.guardaCiclo && c.conv.sinRespuestaDesde ? { sinRespuestaDesde: c.conv.sinRespuestaDesde, nivelMenorA } : undefined);

  // El SELLO: la clave es única por flota. Solo quien la inserta primero avisa.
  const nuevo = await repo.evento(c.tenantId, {
    conversacionId: c.conv.id, tipo: 'escalada', clave: a.clave, nivel: a.nivel,
    detalle: { motivo: a.motivo, minutos: a.minutosEsperando },
  });
  if (!nuevo) {
    // El sello ya existía pero la conversación sigue en un nivel menor: una pasada anterior murió entre el sello y la
    // actualización. Se sube el nivel aquí; si no, el hilo se quedaría en la cola para siempre sin poder avisar.
    await repo.actualizarConversacion(c.tenantId, c.conv.id, { escalamientoNivel: a.nivel }, guarda(a.nivel));
    return 'duplicado';
  }

  const aplicado = await repo.actualizarConversacion(c.tenantId, c.conv.id, { escalamientoNivel: a.nivel, escaladoEn: ahora.toISOString() }, guarda(a.nivel));
  if (!aplicado) return 'obsoleto';
  if (!opciones.enviar) return 'registrado';

  const destinos = await destinatariosDe(repo, c.tenantId, c.contacto, a.nivel);
  if (destinos.length === 0) {
    await repo.evento(c.tenantId, { conversacionId: c.conv.id, tipo: 'sin_destinatario', clave: `${a.clave}:sin_destinatario`, nivel: a.nivel });
    return 'sin_destinatario';
  }
  const ultimo = await repo.ultimoEntranteId(c.tenantId, c.conv.id);
  if (!ultimo) return 'registrado';
  const datosCorreo: DatosAvisoCorreo = { cliente: c.nombreCliente ?? 'Un cliente', motivo: a.motivo, minutos: a.minutosEsperando, nivel: a.nivel };

  // A CADA persona de la lista, por su canal: WhatsApp si tiene teléfono; correo de respaldo si el WhatsApp no salió (y la flota lo
  // encendió) o si solo tiene correo. Lo que ya está en camino (cola de reintento de Meta) NO se duplica por correo.
  let entregado = false;
  for (const d of destinos) {
    const hash = d.telefono ? hashTelefono(d.telefono) : d.correo ? hashCorreo(d.correo) : null;
    let porCorreo = !d.telefono;
    if (d.telefono) {
      const r = await avisarEscalamiento({
        tenantId: c.tenantId, telefonoDestino: d.telefono, mensajeId: ultimo, nombreCliente: c.nombreCliente ?? 'Un cliente',
        motivo: a.motivo, minutosEsperando: a.minutosEsperando, nivel: a.nivel,
      }, deps.enviar);
      if (r.ok) {
        entregado = true;
        await repo.evento(c.tenantId, { conversacionId: c.conv.id, tipo: 'escalada', nivel: a.nivel, destinatarioHash: hash, actorUserId: d.userId, detalle: { entregado: true, canal: 'whatsapp' } });
      } else {
        await repo.evento(c.tenantId, { conversacionId: c.conv.id, tipo: 'fallo_envio', nivel: a.nivel, destinatarioHash: hash, detalle: { motivo: r.motivo, aviso: 'escalamiento' } });
        porCorreo = debeRespaldarPorCorreo(r);
      }
    }
    if (!porCorreo || !d.correo) continue;
    if (!c.config.respaldoCorreo) {
      // Solo tiene correo y el respaldo está apagado: no hay por dónde avisarle, y se deja a la vista (no en silencio).
      if (!d.telefono) await repo.evento(c.tenantId, { conversacionId: c.conv.id, tipo: 'fallo_envio', nivel: a.nivel, destinatarioHash: hash, detalle: { motivo: 'correo_apagado', aviso: 'escalamiento' } });
      continue;
    }
    const res = await respaldarPorCorreo({
      tenantId: c.tenantId, conversacionId: c.conv.id, clave: claveCorreo(a.clave, d.correo), nivel: a.nivel, directorId: d.directorId, correo: d.correo, datos: datosCorreo,
    }, deps);
    if (res === 'enviado') entregado = true;
  }
  return entregado ? 'avisado' : 'fallo_envio';
}

/** A quiénes se avisa en un nivel (lista de directores y, si no hay, el destino de siempre). Si la lista no se puede leer, cae al destino de siempre. */
async function destinatariosDe(repo: RepoVigia, tenantId: string, contacto: Contacto, nivel: NivelDirector): Promise<DestinatarioAviso[]> {
  try {
    return unirDestinatarios(await repo.destinatariosNivel(tenantId, contacto, nivel));
  } catch (e) {
    logger.warn('vigia.destinatarios_lista_fallo', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    const d = await repo.destinatarioNivel(tenantId, contacto, nivel);
    return d ? [{ userId: d.userId, directorId: null, nombre: null, telefono: d.telefono, correo: null }] : [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. LAS DECISIONES DEL GERENTE (botón de WhatsApp y tablero)
// ═══════════════════════════════════════════════════════════════════════════

export interface Actor { tenantId: string; userId: string }

export type ResultadoDecision =
  | { ok: true; mensaje: string }
  | { ok: false; motivo: 'no_encontrado' | 'ya_atendido' | 'texto_invalido' | 'agente_apagado' | 'envio_fallido' | 'contacto'; mensaje: string };

const ESTADOS_DECIDIBLES = ['pendiente_aprobacion', 'borrador'] as const;

async function cargarContexto(actor: Actor, mensaje: MensajeVigia, deps: DepsVigia) {
  const [contacto, config, nombreFlota] = await Promise.all([
    deps.repo.contactoDe(actor.tenantId, mensaje.conversacionId),
    deps.repo.config(actor.tenantId),
    deps.repo.nombreFlota(actor.tenantId),
  ]);
  return { contacto, config, nombreFlota };
}

/** Aprueba (con un toque) y ENVÍA. `textoEditado` = el gerente corrigió el texto. */
export async function aprobarMensaje(actor: Actor, mensajeId: string, deps: DepsVigia, opciones: { textoEditado?: string } = {}): Promise<ResultadoDecision> {
  const { repo } = deps;
  const m = await repo.mensaje(actor.tenantId, mensajeId);
  if (!m || m.direccion !== 'saliente' || m.autor !== 'agente') {
    return { ok: false, motivo: 'no_encontrado', mensaje: 'No encuentro ese mensaje en tu flota.' };
  }
  let texto: string | undefined;
  if (opciones.textoEditado !== undefined) {
    texto = limpiarTexto(opciones.textoEditado).slice(0, MAX_TEXTO_AL_CLIENTE);
    if (!texto) return { ok: false, motivo: 'texto_invalido', mensaje: 'El mensaje editado está vacío.' };
  }
  const { contacto, config, nombreFlota } = await cargarContexto(actor, m, deps);
  if (!contacto) return { ok: false, motivo: 'contacto', mensaje: 'Ese contacto ya no existe.' };

  // El reclamo condicional es lo que impide el doble envío (dos toques, o el botón y el tablero a la vez).
  const reclamado = await repo.reclamarEstado(actor.tenantId, mensajeId, [...ESTADOS_DECIDIBLES], 'aprobado', {
    aprobadoPor: actor.userId, editado: texto !== undefined && texto !== limpiarTexto(m.texto ?? '').slice(0, MAX_TEXTO_AL_CLIENTE), ...(texto !== undefined ? { texto } : {}),
  });
  if (!reclamado) {
    const actual = await repo.mensaje(actor.tenantId, mensajeId);
    return { ok: false, motivo: 'ya_atendido', mensaje: `Ese mensaje ya estaba atendido (${actual?.estado ?? 'sin estado'}).` };
  }
  await repo.evento(actor.tenantId, { conversacionId: m.conversacionId, tipo: 'aprobado', actorUserId: actor.userId, detalle: { editado: reclamado.editado } });

  const r = await enviarSaliente({
    tenantId: actor.tenantId, mensajeId, texto: reclamado.texto ?? '', contacto, config, conversacionId: m.conversacionId, nombreFlota, autoenviado: false,
    // Los archivos salen con lo APROBADO: el gerente los vio en el aviso («adjuntará: …»).
    adjuntos: reclamado.adjuntos ?? m.adjuntos ?? [],
  }, deps);
  if (r.ok) return { ok: true, mensaje: `Listo, se envió la respuesta a ${contacto.nombre ?? 'tu cliente'}.` };
  return { ok: false, motivo: 'envio_fallido', mensaje: `No se pudo enviar: ${r.motivo}. Quedó en el tablero.` };
}

export async function rechazarMensaje(actor: Actor, mensajeId: string, deps: DepsVigia, motivo?: string): Promise<ResultadoDecision> {
  const { repo } = deps;
  const m = await repo.mensaje(actor.tenantId, mensajeId);
  if (!m || m.direccion !== 'saliente') return { ok: false, motivo: 'no_encontrado', mensaje: 'No encuentro ese mensaje en tu flota.' };
  const r = await repo.reclamarEstado(actor.tenantId, mensajeId, [...ESTADOS_DECIDIBLES], 'rechazado', { aprobadoPor: actor.userId, motivoRechazo: (motivo ?? 'rechazado por el gerente').slice(0, 200) });
  if (!r) return { ok: false, motivo: 'ya_atendido', mensaje: 'Ese mensaje ya estaba atendido.' };
  await repo.evento(actor.tenantId, { conversacionId: m.conversacionId, tipo: 'rechazado', actorUserId: actor.userId });
  return { ok: true, mensaje: 'Entendido, no se envió. El cliente sigue esperando: respóndele desde el tablero o toca «Yo me encargo».' };
}

/** «Yo me encargo»: el hilo pasa a manos humanas y el agente deja de redactar. */
export async function tomarConversacion(actor: Actor, conversacionId: string, deps: DepsVigia): Promise<ResultadoDecision> {
  const { repo } = deps;
  const conv = await repo.conversacion(actor.tenantId, conversacionId);
  if (!conv || conv.estado !== 'activa') return { ok: false, motivo: 'no_encontrado', mensaje: 'No encuentro esa conversación activa en tu flota.' };
  const ahora = ahoraDe(deps).toISOString();
  await repo.actualizarConversacion(actor.tenantId, conv.id, {
    control: 'humano', tomadaPor: actor.userId, tomadaEn: ahora, atendidaEn: ahora, atendidaPor: actor.userId,
  });
  // Los borradores pendientes de ese hilo quedan sin efecto: ya los lleva una persona.
  await descartarPendientes(actor.tenantId, conv.id, deps);
  await repo.evento(actor.tenantId, { conversacionId: conv.id, tipo: 'tomada', actorUserId: actor.userId });
  return { ok: true, mensaje: `Listo, el hilo es tuyo: el Vigía ya no redacta ahí. Contesta desde ${appUrl()}/dashboard/agentes/vigia.` };
}

async function descartarPendientes(tenantId: string, conversacionId: string, deps: DepsVigia): Promise<void> {
  for (const id of await deps.repo.pendientesDeHilo(tenantId, conversacionId)) {
    await deps.repo.reclamarEstado(tenantId, id, ['pendiente_aprobacion', 'borrador'], 'descartado', { motivoRechazo: 'el gerente tomó la conversación' });
  }
}

export async function devolverConversacion(actor: Actor, conversacionId: string, deps: DepsVigia): Promise<ResultadoDecision> {
  const { repo } = deps;
  const conv = await repo.conversacion(actor.tenantId, conversacionId);
  if (!conv || conv.estado !== 'activa') return { ok: false, motivo: 'no_encontrado', mensaje: 'No encuentro esa conversación activa en tu flota.' };
  await repo.actualizarConversacion(actor.tenantId, conv.id, { control: 'agente', tomadaPor: null, tomadaEn: null });
  await repo.evento(actor.tenantId, { conversacionId: conv.id, tipo: 'devuelta', actorUserId: actor.userId });
  return { ok: true, mensaje: 'El Vigía vuelve a redactar en este hilo (con tu aprobación, según el modo de tu flota).' };
}

/** El gerente contesta él mismo desde el tablero. Pasa por los mismos límites que todo envío al cliente. */
export async function responderComoHumano(actor: Actor, conversacionId: string, textoCrudo: string, deps: DepsVigia): Promise<ResultadoDecision> {
  const { repo } = deps;
  const conv = await repo.conversacion(actor.tenantId, conversacionId);
  if (!conv || conv.estado !== 'activa') return { ok: false, motivo: 'no_encontrado', mensaje: 'No encuentro esa conversación activa en tu flota.' };
  const texto = limpiarTexto(textoCrudo).slice(0, MAX_TEXTO_AL_CLIENTE);
  if (!texto) return { ok: false, motivo: 'texto_invalido', mensaje: 'Escribe el mensaje.' };
  const [contacto, config, nombreFlota] = await Promise.all([
    repo.contactoDe(actor.tenantId, conv.id), repo.config(actor.tenantId), repo.nombreFlota(actor.tenantId),
  ]);
  if (!contacto) return { ok: false, motivo: 'contacto', mensaje: 'Ese contacto ya no existe.' };
  const creado = await repo.crearSaliente(actor.tenantId, {
    conversacionId: conv.id, respuestaA: null, autor: 'humano', texto, estado: 'aprobado', intencion: null, riesgo: null,
    datosRespaldo: null, senales: [], autoenviado: false, aprobadoPor: actor.userId,
  });
  const r = await enviarSaliente({ tenantId: actor.tenantId, mensajeId: creado.id, texto, contacto, config, conversacionId: conv.id, nombreFlota, autoenviado: false, adjuntos: [] }, deps);
  return r.ok
    ? { ok: true, mensaje: 'Enviado.' }
    : { ok: false, motivo: 'envio_fallido', mensaje: r.motivo };
}

export async function cerrarConversacion(actor: Actor, conversacionId: string, deps: DepsVigia): Promise<ResultadoDecision> {
  const conv = await deps.repo.conversacion(actor.tenantId, conversacionId);
  if (!conv || conv.estado !== 'activa') return { ok: false, motivo: 'no_encontrado', mensaje: 'No encuentro esa conversación activa en tu flota.' };
  await deps.repo.cerrarConversacion(actor.tenantId, conv.id, ahoraDe(deps));
  await deps.repo.evento(actor.tenantId, { conversacionId: conv.id, tipo: 'cerrada', actorUserId: actor.userId });
  return { ok: true, mensaje: 'Conversación cerrada.' };
}

export interface CuentaGerente { tenantId: string | null; rol: string; userId: string }

const ROLES_QUE_DECIDEN: readonly string[] = ['flota_admin', 'encargado'];

/**
 * El botón de WhatsApp. `null` = este texto no es de un botón del Vigía (el
 * llamador sigue con el resto de los comandos de oficina). El tenant sale de la
 * CUENTA, no del id: un id de otra flota no se encuentra.
 */
export async function atenderDecisionVigia(cuenta: CuentaGerente, texto: string, deps: DepsVigia): Promise<string | null> {
  const b: DecisionBoton | null = interpretarBoton(texto);
  if (!b) return null;
  if (!cuenta.tenantId || !ROLES_QUE_DECIDEN.includes(cuenta.rol)) {
    return 'Tu rol no puede aprobar respuestas a clientes. Pídeselo al encargado o al dueño de la flota.';
  }
  const actor: Actor = { tenantId: cuenta.tenantId, userId: cuenta.userId };
  try {
    if (b.accion === 'aprobar') return (await aprobarMensaje(actor, b.id, deps)).mensaje;
    if (b.accion === 'rechazar') return (await rechazarMensaje(actor, b.id, deps)).mensaje;
    // «Yo me encargo»: el id puede ser el de un borrador o el de un entrante; ambos resuelven al hilo.
    const m = await deps.repo.mensaje(actor.tenantId, b.id);
    if (!m) return 'No encuentro esa conversación en tu flota.';
    return (await tomarConversacion(actor, m.conversacionId, deps)).mensaje;
  } catch (e) {
    logger.error('vigia.decision_fallo', { tenant: actor.tenantId, accion: b.accion, err: e instanceof Error ? e.message : String(e) });
    return 'No pude completar eso ahora. Inténtalo otra vez o hazlo desde el tablero del Vigía.';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. EL BARRIDO (cron cada 5 minutos)
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoBarrido {
  revisadas: number;
  escaladas: number;
  duplicadas: number;
  sinDestinatario: number;
  fallosEnvio: number;
  atorados: number;
  purgadas: number;
  /** Hilos de ciclo muerto que se cerraron (ver `DIAS_CICLO_INACTIVO`). */
  expiradas: number;
  /** 0674: correos de respaldo cuyo arriendo venció y se retomaron. */
  correosRetomados: number;
  cortadoPorReloj: boolean;
}

/** Un aprobado sin enviar tras este tiempo se da por interrumpido (NO se reenvía: podría haber salido). */
export const MINUTOS_APROBADO_ATORADO = 5;

/**
 * `mantenimiento: false` salta lo que no corre contra el reloj de un cliente (atorados, expiración, retención): el cron pasa cada
 * minuto para que la alerta de 10 min salga a tiempo, y eso solo hace falta cada pocos minutos.
 */
export async function barridoVigia(deps: DepsVigia, opciones: { limite?: number; vencePorReloj?: number; mantenimiento?: boolean } = {}): Promise<ResultadoBarrido> {
  const { repo } = deps;
  const ahora = ahoraDe(deps);
  const r: ResultadoBarrido = { revisadas: 0, escaladas: 0, duplicadas: 0, sinDestinatario: 0, fallosEnvio: 0, atorados: 0, purgadas: 0, expiradas: 0, correosRetomados: 0, cortadoPorReloj: false };

  const filas = await repo.conversacionesEnEspera(opciones.limite ?? 100, ahora);
  for (const f of filas) {
    if (opciones.vencePorReloj && Date.now() >= opciones.vencePorReloj) { r.cortadoPorReloj = true; break; }
    r.revisadas += 1;
    try {
      const conv = f.conversacion;
      // La molestia por TIEMPO: el cliente que espera sube de nivel aunque no vuelva a escribir.
      const espera = minutosEsperando(conv.sinRespuestaDesde, ahora.getTime());
      const molestia = evaluarMolestia({
        texto: '', intencion: 'otro', entradasSinRespuesta: conv.entradasSinRespuesta, minutosEsperando: espera, slaRespuestaMin: f.config.slaRespuestaMin,
      });
      const convActual = { ...conv };
      if (molestia.nivel > conv.molestiaNivel) {
        const aplicada = conv.sinRespuestaDesde
          ? await repo.actualizarConversacion(f.config.tenantId, conv.id, { molestiaNivel: molestia.nivel, molestiaMotivos: molestia.motivos, molestiaEn: ahora.toISOString() }, { sinRespuestaDesde: conv.sinRespuestaDesde })
          : false;
        if (!aplicada) continue;   // ya contestada (o ciclo nuevo) desde que se leyó la fila: nada que subir ni avisar
        convActual.molestiaNivel = molestia.nivel;
        convActual.molestiaMotivos = molestia.motivos;
        convActual.molestiaEn = ahora.toISOString();
      }
      const accion = evaluarEscalamiento({ conversacion: convActual, config: f.config, ahoraMs: ahora.getTime() });
      if (!accion) continue;
      const nombreCliente = await repo.nombreCliente(f.config.tenantId, conv.clienteId);
      const res = await ejecutarEscalamiento(accion, { tenantId: f.config.tenantId, conv, contacto: f.contacto, config: f.config, nombreCliente: nombreCliente ?? f.contacto.nombre }, deps, { enviar: true, guardaCiclo: true });
      if (res === 'avisado' || res === 'registrado') r.escaladas += 1;
      else if (res === 'duplicado') r.duplicadas += 1;
      else if (res === 'obsoleto') continue;
      else if (res === 'sin_destinatario') r.sinDestinatario += 1;
      else r.fallosEnvio += 1;
    } catch (e) {
      r.fallosEnvio += 1;
      logger.error('vigia.barrido_fila_fallo', { conversacion: f.conversacion.id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  if (opciones.mantenimiento === false) return r;

  // 0674: los correos de respaldo que la corrida anterior dejó a medias (arriendo vencido). Mismo reclamo: si otra corrida los retomó, no se repiten.
  r.correosRetomados = await reintentarCorreosVencidos(deps, 20);

  const atorados = await repo.aprobadosAtorados(new Date(ahora.getTime() - MINUTOS_APROBADO_ATORADO * 60_000), 50);
  for (const a of atorados) {
    await repo.marcarFallido(a.tenantId, a.id, 'envío interrumpido: no se sabe si salió, revísalo antes de reenviar').catch(() => {});
    r.atorados += 1;
  }
  // Ciclos muertos: cerrados con su huella en la bitácora (sin texto ni teléfono). Una falla aquí no tira el barrido.
  try {
    const cerradas = await repo.expirarCiclosInactivos(new Date(ahora.getTime() - DIAS_CICLO_INACTIVO * 86_400_000), 100, ahora);
    for (const x of cerradas) {
      await repo.evento(x.tenantId, { conversacionId: x.id, tipo: 'cerrada', detalle: { motivo: 'ciclo_inactivo', dias: DIAS_CICLO_INACTIVO } }).catch(() => false);
    }
    r.expiradas = cerradas.length;
  } catch (e) {
    logger.error('vigia.expirar_ciclos_fallo', { err: e instanceof Error ? e.message : String(e) });
  }
  r.purgadas = await repo.purgar(500).catch((e) => {
    logger.error('vigia.purga_fallo', { err: e instanceof Error ? e.message : String(e) });
    return 0;
  });
  return r;
}
