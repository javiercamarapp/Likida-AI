import { puedeAdministrar } from '@/lib/auth/permisos';
import { diaEnZona } from '@/lib/formato';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { crearRepoVigia, guardarConfigSinAtender, leerConfigSinAtender, leerDestinatariosResumen, type DestinatariosResumenCrudos } from '../repo';
import { leerChatsParaSinAtender, type ChatLeido } from '../historial/repo';
import { hashAutor, salDeFlota } from '../historial/export_whatsapp';
import { configEfectiva, configGuardadaDeFormulario, equipoDeLaRevision, solicitudDeFormulario, type PlazosFlota, type PuertoConfigSinAtender, type SolicitudSinAtender } from './config_pantalla';
import { destinatariosDelResumen } from './destinatarios';
import { enviarResumenSinAtender, type MotivoNoEnviadoResumen } from './correo';
import { resumenHabilitadoParaFlota, type EstadoResumen } from './interruptor';
import { detectarSinAtender, type ConfigGuardadaSinAtender, type ConfigSinAtender, type ResultadoSinAtender } from './motor';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DE LA PANTALLA «SIN ATENDER» — con puertos para probarlas.
// Revisar no guarda nada: cada revisión usa los plazos de la flota, lo que la flota dejó guardado (0999: horario de atención, palabras,
// equipo, insistencia) y lo que se escribe en el formulario de la prueba. Guardar la configuración y enviar el resumen son de quien
// administra la flota; el resumen sale solo por clic, con TODAS las capas encendidas (plataforma y flota), y ambos se asientan en la
// bitácora con conteos (jamás texto de mensajes ni nombres). El tenant sale de la sesión, nunca del formulario.
// ═══════════════════════════════════════════════════════════════════════════

export interface ContextoSinAtender { tenantId: string; rol: string; usuarioId: string | null; email: string | null; liga: string }

export interface DepsSinAtender {
  leerChats: (tenantId: string) => Promise<{ chats: ChatLeido[]; gruposOmitidos: number } | null>;
  leerPlazos: (tenantId: string) => Promise<PlazosFlota | null>;
  leerDestinatarios: (tenantId: string) => Promise<DestinatariosResumenCrudos>;
  puertoConfig: PuertoConfigSinAtender;
  detectar: typeof detectarSinAtender;
  /** Plataforma (bandera e interruptores) Y el interruptor propio de la flota. Apagado ante cualquier duda. */
  habilitado: (tenantId: string) => Promise<EstadoResumen>;
  enviar: typeof enviarResumenSinAtender;
  bitacora: typeof anotarBitacora;
  ahora: () => number;
}
export const puertoConfigSinAtenderReal: PuertoConfigSinAtender = {
  leer: (tenantId) => leerConfigSinAtender(tenantId),
  guardar: async (tenantId, userId, valor) => {
    const r = await guardarConfigSinAtender(tenantId, userId, valor);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
};

export const depsSinAtenderReales: DepsSinAtender = {
  leerChats: leerChatsParaSinAtender,
  leerPlazos: async (t) => {
    const c = await crearRepoVigia().config(t);
    return c ? { slaRespuestaMin: c.slaRespuestaMin, slaCriticoMin: c.slaCriticoMin } : null;
  },
  leerDestinatarios: leerDestinatariosResumen,
  puertoConfig: puertoConfigSinAtenderReal,
  detectar: detectarSinAtender,
  habilitado: (t) => resumenHabilitadoParaFlota(t, async (id) => (await leerConfigSinAtender(id)).resumenCorreoHabilitado),
  enviar: enviarResumenSinAtender,
  bitacora: anotarBitacora,
  ahora: () => Date.now(),
};

// Igual al tope del motor (MAX_VISTA_PREVIA = 80): un valor mayor vuelve inválida la configuración.
export const VISTA_PREVIA_PANTALLA = 80;

export interface Revision {
  resultado: ResultadoSinAtender;
  config: ConfigSinAtender;
  /** grupo -> cliente (para elegir al servicio al cliente correcto). */
  clienteDeChat: Map<string, string>;
  gruposRevisados: number;
  gruposOmitidos: number;
  /** El equipo declarado no coincide con nadie: lo escrito saldría todo como cliente. */
  equipoSinCoincidencias: boolean;
  crudos: DestinatariosResumenCrudos;
}
export type ResultadoRevision = { ok: true; revision: Revision } | { ok: false; error: string; sinDatos?: boolean };

/** Lee, arma la configuración y corre el detector. No escribe nada. */
export async function revisarSinAtender(tenantId: string, solicitud: SolicitudSinAtender, vistaPreviaMax: number, d: DepsSinAtender = depsSinAtenderReales): Promise<ResultadoRevision> {
  const leidos = await d.leerChats(tenantId);
  if (leidos === null) return { ok: false, sinDatos: true, error: 'Los grupos e históricos de clientes todavía no están disponibles en tu cuenta. Avísale a Likida.' };
  const [plazos, guardada, crudos] = await Promise.all([d.leerPlazos(tenantId), d.puertoConfig.leer(tenantId), d.leerDestinatarios(tenantId)]);
  const sal = salDeFlota(tenantId);
  // El equipo es el guardado de la flota MÁS los nombres escritos para esta revisión.
  const equipoHashes = equipoDeLaRevision(guardada?.equipoNombres ?? [], solicitud.equipoNombres ?? []).map((n) => hashAutor(sal, n));
  const cfg = configEfectiva({ plazos, guardada, solicitud, equipoHashes, zona: crudos.zona, festivos: crudos.festivos, vistaPreviaMax });
  if (!cfg.ok) return { ok: false, error: cfg.error };
  const ahora = d.ahora();
  const resultado = d.detectar(leidos.chats.map((c) => c.chat), cfg.config, ahora);
  const hashes = new Set(equipoHashes);
  const hayCoincidencia = leidos.chats.some((c) => c.chat.mensajes.some((m) => hashes.has(m.autorHash)));
  return {
    ok: true,
    revision: {
      resultado, config: cfg.config, clienteDeChat: new Map(leidos.chats.map((c) => [c.chat.chatId, c.clienteId])),
      gruposRevisados: leidos.chats.length, gruposOmitidos: leidos.gruposOmitidos, equipoSinCoincidencias: hashes.size > 0 && !hayCoincidencia, crudos,
    },
  };
}

export interface ResumenGrupoSinAtender { alertas: number; altas: number }

/**
 * Tras subir un chat: corre el detector (sin guardar nada, sin texto de mensajes) y cuenta lo que quedó sin atender EN ESE grupo.
 * Devuelve null si no se pudo revisar (la importación ya está guardada: un fallo aquí nunca la deshace).
 */
export async function resumenSinAtenderDeGrupo(tenantId: string, grupoId: string, equipoNombres: readonly string[], d: DepsSinAtender = depsSinAtenderReales): Promise<ResumenGrupoSinAtender | null> {
  const r = await resumenSinAtenderDeGrupos(tenantId, [grupoId], equipoNombres, d);
  return r?.get(grupoId) ?? null;
}

/**
 * Lo mismo para VARIOS grupos con UNA sola revisión (una lectura de los históricos de la flota, no una por grupo): es lo que usa la
 * subida por lote al final, en lugar de releer todo el histórico tras cada archivo (R7-A4). null si no se pudo revisar.
 */
export async function resumenSinAtenderDeGrupos(tenantId: string, grupoIds: readonly string[], equipoNombres: readonly string[], d: DepsSinAtender = depsSinAtenderReales): Promise<Map<string, ResumenGrupoSinAtender> | null> {
  try {
    const r = await revisarSinAtender(tenantId, { equipoNombres: [...equipoNombres] }, 0, d);
    if (!r.ok) return null;
    const porGrupo = new Map<string, ResumenGrupoSinAtender>();
    for (const id of new Set(grupoIds)) {
      const delGrupo = r.revision.resultado.alertas.filter((a) => a.chatId === id);
      porGrupo.set(id, { alertas: delGrupo.length, altas: delGrupo.filter((a) => a.nivel === 'alta').length });
    }
    return porGrupo;
  } catch (e) {
    logger.warn('vigia.sin_atender_tras_importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export type EstadoRevisionUI =
  | null
  | { ok: true; resultado: ResultadoSinAtender; notas: string[] }
  | { ok: false; error: string };

/** «Revisar con estos ajustes»: la prueba no se guarda. */
export async function revisarPanel(ctx: ContextoSinAtender, fd: FormData, d: DepsSinAtender = depsSinAtenderReales): Promise<EstadoRevisionUI> {
  const s = solicitudDeFormulario(fd);
  if (!s.ok) return { ok: false, error: s.error };
  try {
    const r = await revisarSinAtender(ctx.tenantId, s.valor, VISTA_PREVIA_PANTALLA, d);
    if (!r.ok) return { ok: false, error: r.error };
    const notas: string[] = [];
    if (r.revision.equipoSinCoincidencias) notas.push('Ningún mensaje coincide con los nombres de tu equipo que escribiste: revisa que estén igual que en el chat.');
    if (r.revision.gruposOmitidos > 0) notas.push(`Solo se revisaron ${r.revision.gruposRevisados} grupos; ${r.revision.gruposOmitidos} quedaron fuera.`);
    return { ok: true, resultado: r.revision.resultado, notas };
  } catch (e) {
    logger.error('vigia.sin_atender_revisar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'revisar las conversaciones') };
  }
}

/** Deja solo las alertas cuyo primer mensaje sin atender es del día de corte (hora de la flota) en adelante, y recuenta el resumen. */
export function recortarPorCorte(r: ResultadoSinAtender, zona: string, corte: string): ResultadoSinAtender {
  const alertas = r.alertas.filter((a) => diaEnZona(new Date(a.desde), zona) >= corte);
  const porTurno = { dia: 0, noche: 0, festivo: 0 };
  for (const a of alertas) porTurno[a.turno]++;
  return {
    ...r, alertas,
    resumen: {
      ...r.resumen, alertas: alertas.length, chatsConAlerta: new Set(alertas.map((a) => a.chatId)).size,
      altas: alertas.filter((a) => a.nivel === 'alta').length, normales: alertas.filter((a) => a.nivel === 'normal').length,
      masAntiguaMin: alertas.length ? Math.max(...alertas.map((a) => a.antiguedadMin)) : null, porTurno,
    },
  };
}

const TEXTO_MOTIVO: Record<MotivoNoEnviadoResumen, string> = {
  interruptor_apagado: 'El envío del resumen está apagado en la plataforma. No se mandó nada.',
  flota_apagada: 'El resumen por correo está apagado para tu flota. Quien administra puede encenderlo en «Configuración de tu flota»; no se mandó nada.',
  bandera_apagada: 'El resumen por correo todavía no está encendido para tu cuenta. Pídele a Likida que lo encienda; no se mandó nada.',
  sin_alertas: 'No hay conversaciones sin atender en la revisión (con esa fecha de corte): no se mandó nada.',
  sin_destinatarios: 'No hay a quién mandárselo: agrega correos en servicio al cliente o en la lista de directores del Vigía. No se mandó nada.',
  sin_configurar: 'El correo de Likida no está configurado en esta cuenta. No se mandó nada.',
  rechazado: 'El proveedor de correo rechazó el envío. Intenta de nuevo en unos minutos.',
  red: 'No se pudo conectar con el proveedor de correo. Intenta de nuevo en unos minutos.',
  sin_permiso: 'Solo quien administra la flota puede mandar el resumen por correo.',
  sin_fecha_corte: 'Indica la fecha de corte (AAAA-MM-DD): no se avisa de conversaciones anteriores a ese día.',
};
export type ResultadoEnvioUI = { ok: true; mensaje: string } | { ok: false; error: string };

/** «Enviar resumen por correo»: solo administración, solo por clic, con fecha de corte obligatoria y sin texto de mensajes. */
export async function enviarResumenPanel(ctx: ContextoSinAtender, fd: FormData, d: DepsSinAtender = depsSinAtenderReales): Promise<ResultadoEnvioUI> {
  const no = (m: MotivoNoEnviadoResumen): ResultadoEnvioUI => ({ ok: false, error: TEXTO_MOTIVO[m] });
  if (!puedeAdministrar(ctx.rol)) return no('sin_permiso');
  const s = solicitudDeFormulario(fd);
  if (!s.ok) return { ok: false, error: s.error };
  if (!s.valor.fechaCorte) return no('sin_fecha_corte');
  try {
    const estado = await d.habilitado(ctx.tenantId);
    if (!estado.ok) return no(estado.motivo);
    const r = await revisarSinAtender(ctx.tenantId, s.valor, 0, d);
    if (!r.ok) return { ok: false, error: r.error };
    const rev = r.revision;
    const resultado = recortarPorCorte(rev.resultado, rev.crudos.zona, s.valor.fechaCorte);
    const ahora = new Date(d.ahora());
    const { destinatarios, turno } = destinatariosDelResumen({ crudos: rev.crudos, alertas: resultado.alertas, clienteDeChat: rev.clienteDeChat, ahora });
    const fechaLocal = diaEnZona(ahora, rev.crudos.zona);
    const envio = await d.enviar({ tenantId: ctx.tenantId, resultado, destinatarios, liga: ctx.liga, turno, fechaLocal }, { habilitado: () => d.habilitado(ctx.tenantId) });
    await d.bitacora({
      tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'vigia.sin_atender_resumen', entidad: 'vigia_historial', entidadId: ctx.tenantId,
      detalle: { enviado: envio.ok, motivo: envio.ok ? null : envio.motivo, alertas: resultado.alertas.length, destinatarios: destinatarios.length, turno, fechaLocal, corte: s.valor.fechaCorte },
    });
    if (!envio.ok) return no(envio.motivo);
    return { ok: true, mensaje: `Resumen enviado a ${envio.destinatarios} ${envio.destinatarios === 1 ? 'persona' : 'personas'} (turno ${turno === 'dia' ? 'de día' : turno === 'noche' ? 'de noche' : 'de festivo o fin de semana'}). Si lo repites en el mismo turno y el mismo día con las mismas conversaciones, el proveedor normalmente no lo duplica (no está garantizado); no lo mandes más de una vez.` };
  } catch (e) {
    logger.error('vigia.sin_atender_enviar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'mandar el resumen') };
  }
}

export type ResultadoGuardadoUI = { ok: true; mensaje: string } | { ok: false; error: string };

/**
 * «Guardar configuración»: SOLO administración. Guarda horario de atención, palabras, equipo, insistencia y el interruptor del resumen por correo de ESTA flota
 * (el tenant sale de la sesión). Se asienta en la bitácora con conteos: ni nombres ni texto de mensajes. No manda nada ni lee chats.
 */
export async function guardarConfigPanel(ctx: ContextoSinAtender, fd: FormData, d: DepsSinAtender = depsSinAtenderReales): Promise<ResultadoGuardadoUI> {
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: 'Solo quien administra la flota puede guardar esta configuración.' };
  const c = configGuardadaDeFormulario(fd);
  if (!c.ok) return { ok: false, error: c.error };
  try {
    const r = await d.puertoConfig.guardar(ctx.tenantId, ctx.usuarioId, c.valor);
    if (!r.ok) return { ok: false, error: r.error };
    const v: ConfigGuardadaSinAtender = c.valor;
    // La configuración ya quedó guardada: si la bitácora falla no se reporta como fallo de guardado.
    try {
      await d.bitacora({
        tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'vigia.sin_atender_config', entidad: 'vigia_historial', entidadId: ctx.tenantId,
        detalle: {
          horario: v.horarioAtencion !== null, palabrasClave: v.palabrasClave.length, palabrasUrgentes: v.palabrasUrgentes.length, equipo: v.equipoNombres.length,
          insistenciaMin: v.insistenciaMin, umbralUrgenteMin: v.umbralUrgenteMin, resumenCorreo: v.resumenCorreoHabilitado,
        },
      });
    } catch (e) {
      logger.error('vigia.sin_atender_config_bitacora_fallo', { err: e instanceof Error ? e.message : String(e) });
    }
    return { ok: true, mensaje: 'Configuración guardada. Se usa en cada revisión de tu flota; los chats que ya subiste no se tocan.' };
  } catch (e) {
    logger.error('vigia.sin_atender_config_guardar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'guardar la configuración') };
  }
}
