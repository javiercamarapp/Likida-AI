// ═══════════════════════════════════════════════════════════════════════════
// AVISOS DE SOPORTE al superadmin (auditoría admin, 10-nov-2026, P0).
//
// El hallazgo: `abrirTicket` y `responderTicket` solo escribían en la base.
// Nadie recibía correo ni WhatsApp; un ticket podía esperar días sin que nadie
// lo supiera, y el SLA se pintaba «vencido» sin consecuencia alguna.
//
// Tres avisos, dos canales (correo por Resend a ALERTA_EMAIL, y el WhatsApp
// interino ALERTA_WA), mismo destinatario que el resto de alertas del operador:
//   · `avisarTicketNuevo`        — un cliente abrió un ticket.
//   · `avisarRespuestaDelCliente` — el cliente respondió en su hilo.
//   · `escalarSlasVencidos`      — barrido: tickets abiertos con SLA vencido.
//
// REGLAS:
//   · DEDUP PERSISTENTE: cada aviso queda en `bitacora_auditoria` (accion +
//     id del ticket o del mensaje) y NO se repite. El dedup solo se anota si
//     el aviso SALIÓ por algún canal: un aviso sin canal configurado no se da
//     por «ya avisado».
//   · FALLA CERRADO Y DECLARADO: el resultado dice qué canal salió y cuál no
//     (`enviado | sin_configurar | fallo`) y un aviso que no salió por NINGÚN
//     canal se loguea `warn`. Nunca lanza: un aviso caído no tumba al ticket
//     que lo disparó. Si el dedup no se pudo leer, se avisa igual (mejor un
//     duplicado que un silencio) y se dice.
//   · Sin datos personales en el cuerpo: asunto del ticket y nombre de la flota.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { enviarCorreo } from '@/lib/correo/enviar';
import { alertaWhatsAppConfigurada } from '@/lib/observability/alerta';
import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';

export type EstadoCanal = 'enviado' | 'sin_configurar' | 'fallo';

export interface ResultadoAviso {
  /** Ya se había avisado antes: no se mandó nada. */
  yaAvisado: boolean;
  correo: EstadoCanal | 'omitido';
  whatsapp: EstadoCanal | 'omitido';
  /** Salió por al menos un canal. */
  avisado: boolean;
}

export const ACCIONES_AVISO = {
  nuevo: 'soporte.aviso_ticket_nuevo',
  respuesta: 'soporte.aviso_respuesta_cliente',
  sla: 'soporte.aviso_sla_vencido',
} as const;

export interface TicketParaAviso {
  ticketId: string;
  tenantId: string;
  asunto: string;
  prioridad?: string | null;
  flotaNombre?: string | null;
  venceEn?: string | null;
}

export interface Aviso {
  accion: string;
  /** Llave del dedup: el ticket, o el mensaje si el evento puede repetirse. */
  entidadId: string;
  tenantId: string;
  asunto: string;
  titulo: string;
  parrafo: string;
  datos: Array<[string, string]>;
  tono: 'neutral' | 'atencion' | 'urgente';
  textoWa: string;
}

const enlaceTicket = (id: string) => `${appUrl()}/admin/soporte?ticket=${encodeURIComponent(id)}`;

async function yaSeAviso(accion: string, tenantId: string, entidadId: string): Promise<boolean | null> {
  try {
    // orden-no-importa: solo se pregunta si existe alguna fila del aviso (se lee la presencia, no cuál fila es)
    const { data, error } = await acotada(
      supabaseAdmin().from('bitacora_auditoria').select('id')
        .eq('tenant_id', tenantId).eq('accion', accion)
        .eq('entidad', 'ticket_soporte').eq('entidad_id', entidadId).limit(1),
      'soporteAvisos.dedup',
    );
    if (error) { logger.warn('soporte.aviso_dedup_ilegible', { accion, err: error.message }); return null; }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    logger.warn('soporte.aviso_dedup_ilegible', { accion, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function porCorreo(a: Aviso): Promise<EstadoCanal | 'omitido'> {
  const para = process.env.ALERTA_EMAIL;
  if (!para) return 'sin_configurar';
  try {
    const r = await enviarCorreo(para, {
      asunto: `[Likida] ${a.asunto}`,
      avance: a.parrafo.slice(0, 120),
      titulo: a.titulo,
      parrafos: [a.parrafo],
      datos: a.datos,
      boton: { texto: 'Abrir el ticket', href: enlaceTicket(a.entidadId.split(':')[0]) },
      tono: a.tono,
      porQueLoRecibes: 'Recibes este aviso porque ALERTA_EMAIL apunta a esta dirección: es el canal del operador de Likida, no de una flota.',
    }, { sobrio: true });
    if (r.ok) return 'enviado';
    return r.motivo === 'sin_configurar' ? 'sin_configurar' : 'fallo';
  } catch (e) {
    logger.warn('soporte.aviso_correo_fallo', { accion: a.accion, err: e instanceof Error ? e.message : String(e) });
    return 'fallo';
  }
}

async function porWhatsApp(a: Aviso): Promise<EstadoCanal | 'omitido'> {
  if (!alertaWhatsAppConfigurada()) return 'sin_configurar';
  try {
    const { enviarTexto } = await import('@/lib/meta/client');
    const r = await enviarTexto(String(process.env.ALERTA_WA), a.textoWa.slice(0, 1500));
    if (!r.ok) logger.warn('soporte.aviso_wa_no_salio', { accion: a.accion, motivo: r.error });
    return r.ok === true ? 'enviado' : 'fallo';
  } catch (e) {
    logger.warn('soporte.aviso_wa_fallo', { accion: a.accion, err: e instanceof Error ? e.message : String(e) });
    return 'fallo';
  }
}

/** Manda un aviso por los dos canales, con dedup. NUNCA lanza. */
export async function avisarSuperadmin(a: Aviso): Promise<ResultadoAviso> {
  try {
    if ((await yaSeAviso(a.accion, a.tenantId, a.entidadId)) === true) {
      return { yaAvisado: true, correo: 'omitido', whatsapp: 'omitido', avisado: false };
    }
    const [correo, whatsapp] = await Promise.all([porCorreo(a), porWhatsApp(a)]);
    const avisado = correo === 'enviado' || whatsapp === 'enviado';
    if (avisado) {
      await anotarBitacora(
        { tenantId: a.tenantId, actor: 'sistema', accion: a.accion, entidad: 'ticket_soporte', entidadId: a.entidadId, detalle: { correo, whatsapp } },
        { evento: 'soporte.aviso_bitacora_no_escribio', contexto: { entidadId: a.entidadId } },
      );
    } else {
      // Declarado: el aviso NO salió y nadie lo sabría sin esta línea.
      logger.warn('soporte.aviso_sin_salir', { accion: a.accion, entidadId: a.entidadId, correo, whatsapp });
    }
    return { yaAvisado: false, correo, whatsapp, avisado };
  } catch (e) {
    logger.warn('soporte.aviso_fallo', { accion: a.accion, err: e instanceof Error ? e.message : String(e) });
    return { yaAvisado: false, correo: 'fallo', whatsapp: 'fallo', avisado: false };
  }
}

/** El nombre de la flota si el llamador no lo trae. Nunca lanza: sin dato, `null` y el aviso dice «una flota». */
async function conNombreDeFlota(t: TicketParaAviso): Promise<TicketParaAviso> {
  if (t.flotaNombre !== undefined) return t;
  try {
    const { data, error } = await acotada(
      supabaseAdmin().from('tenant').select('nombre').eq('id', t.tenantId).maybeSingle(),
      'soporteAvisos.flota',
    );
    return { ...t, flotaNombre: error ? null : ((data as { nombre?: string } | null)?.nombre ?? null) };
  } catch {
    return { ...t, flotaNombre: null };
  }
}

const flota = (t: TicketParaAviso) => t.flotaNombre?.trim() || 'una flota';
const asuntoCorto = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120);

export async function avisarTicketNuevo(t0: TicketParaAviso): Promise<ResultadoAviso> {
  const t = await conNombreDeFlota(t0);
  return avisarSuperadmin({
    accion: ACCIONES_AVISO.nuevo, entidadId: t.ticketId, tenantId: t.tenantId,
    asunto: `Ticket nuevo: ${asuntoCorto(t.asunto)}`,
    titulo: 'Un cliente abrió un ticket de soporte',
    parrafo: `${flota(t)} abrió un ticket${t.prioridad ? ` de prioridad ${t.prioridad}` : ''}: «${asuntoCorto(t.asunto)}».`,
    datos: [['Flota', flota(t)], ['Prioridad', t.prioridad ?? '—'], ['SLA vence', t.venceEn ?? 'sin SLA pactado']],
    tono: t.prioridad === 'urgente' || t.prioridad === 'alta' ? 'urgente' : 'atencion',
    textoWa: `Likida - ticket nuevo de ${flota(t)}: ${asuntoCorto(t.asunto)}\n${enlaceTicket(t.ticketId)}`,
  });
}

export async function avisarRespuestaDelCliente(t0: TicketParaAviso, mensajeId: string): Promise<ResultadoAviso> {
  const t = await conNombreDeFlota(t0);
  return avisarSuperadmin({
    // Un mensaje por aviso: el cliente puede responder varias veces.
    accion: ACCIONES_AVISO.respuesta, entidadId: `${t.ticketId}:${mensajeId}`, tenantId: t.tenantId,
    asunto: `El cliente respondió: ${asuntoCorto(t.asunto)}`,
    titulo: 'Un cliente respondió en su ticket',
    parrafo: `${flota(t)} escribió en el ticket «${asuntoCorto(t.asunto)}». Espera respuesta de Likida.`,
    datos: [['Flota', flota(t)], ['Prioridad', t.prioridad ?? '—']],
    tono: 'atencion',
    textoWa: `Likida - ${flota(t)} respondió en su ticket: ${asuntoCorto(t.asunto)}\n${enlaceTicket(t.ticketId)}`,
  });
}

export function avisarSlaVencido(t: TicketParaAviso, horasVencido: number): Promise<ResultadoAviso> {
  const h = Math.max(0, Math.round(horasVencido));
  return avisarSuperadmin({
    accion: ACCIONES_AVISO.sla, entidadId: t.ticketId, tenantId: t.tenantId,
    asunto: `SLA vencido: ${asuntoCorto(t.asunto)}`,
    titulo: 'Un ticket venció su SLA',
    parrafo: `El ticket «${asuntoCorto(t.asunto)}» de ${flota(t)} lleva ${h} h vencido y sigue sin cerrarse.`,
    datos: [['Flota', flota(t)], ['Prioridad', t.prioridad ?? '—'], ['Vencido hace', `${h} h`]],
    tono: 'urgente',
    textoWa: `Likida - SLA VENCIDO (${h} h): ${asuntoCorto(t.asunto)} de ${flota(t)}\n${enlaceTicket(t.ticketId)}`,
  });
}

export interface ResultadoBarridoSla {
  /** Tickets abiertos con SLA vencido encontrados (hasta el tope). */
  vencidos: number;
  escalados: number;
  yaAvisados: number;
  sinSalir: number;
}

export const TOPE_BARRIDO_SLA = 100;

/**
 * El barrido de SLA: busca tickets NO terminales cuyo `vence_en` ya pasó y
 * escala cada uno UNA vez. LANZA si no se pudo leer la cola (un barrido ciego
 * que devolviera ceros diría «ningún SLA vencido»).
 */
export async function escalarSlasVencidos(ahoraMs: number = Date.now()): Promise<ResultadoBarridoSla> {
  const { data, error } = await acotada(
    supabaseAdmin().from('ticket_soporte')
      .select('id, tenant_id, asunto, prioridad, vence_en, tenant:tenant_id(nombre)')
      .not('estado', 'in', '(resuelto,cerrado)')
      .not('vence_en', 'is', null)
      .lt('vence_en', new Date(ahoraMs).toISOString())
      .order('vence_en', { ascending: true })
      .order('id')
      .limit(TOPE_BARRIDO_SLA),
    'soporteAvisos.barridoSla',
  );
  if (error) throw new Error(`escalarSlasVencidos: ${error.message}`);
  const filas = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const r: ResultadoBarridoSla = { vencidos: filas.length, escalados: 0, yaAvisados: 0, sinSalir: 0 };
  for (const f of filas) {
    const venceEn = String(f.vence_en);
    const res = await avisarSlaVencido({
      ticketId: String(f.id), tenantId: String(f.tenant_id), asunto: String(f.asunto),
      prioridad: (f.prioridad as string | null) ?? null,
      flotaNombre: ((f.tenant as { nombre?: string } | null)?.nombre) ?? null,
      venceEn,
    }, (ahoraMs - Date.parse(venceEn)) / 3_600_000);
    if (res.yaAvisado) r.yaAvisados += 1;
    else if (res.avisado) r.escalados += 1;
    else r.sinSalir += 1;
  }
  return r;
}
