// ═══════════════════════════════════════════════════════════════════════════
// LA COLA DE APROBACIÓN GENÉRICA (`cola_aprobacion`, 0117) — el único módulo
// que la lee y escribe.
//
// LAS TRES ACCIONES, NI UNA MÁS (panel-de-adquisicion §3): aprobar tal cual,
// editar-y-aprobar (la versión editada es la que sale; el diff queda
// derivable de cuerpo vs cuerpo_final), rechazar con motivo obligatorio.
//
// TODA transición va ANCLADA a `estado = 'pendiente'` (patrón
// reclamarEscalacion): dos resoluciones simultáneas no se pisan — la segunda
// toca cero filas y SE DICE. Y "enviar" ni siquiera es decisión de este
// módulo: `marcarEnviada` solo estampa la fecha, y el CHECK
// `cola_enviado_solo_aprobado` de la base la rebota sobre cualquier fila no
// aprobada — el candado es de esquema, no de UI ni de este archivo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { DatoInvalido } from '../errores';
import { logger } from '@/lib/logger';
import { enviarCorreo } from '@/lib/correo/enviar';
import { TZ_MX } from '@/lib/formato';

/** El tope de correos FRÍOS aprobados por día (Fase 2: "20–40, máximo" —
 *  reputación del dominio + lo que el embudo humano digiere). Vive en
 *  config (env), no hardcodeado, para ajustarse sin tocar código. */
export function topeCorreoFrioDia(): number {
  const v = Number(process.env.LIKIDA_TOPE_CORREO_FRIO_DIA);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
}

export type PrioridadPieza = 'normal' | 'urgente';

export interface PiezaNueva {
  tipo: string;
  prioridad: PrioridadPieza;
  /** El agente DECLARADO que la preparó (FK a agente_definicion). */
  agente: string;
  tenantId?: string | null;
  prospectoId?: string | null;
  titulo: string;
  cuerpo: string;
  /** Trazabilidad: de dónde salió cada dato. Sin datos personales de más. */
  fuentes?: Record<string, unknown> | null;
}

const TIPO_RE = /^[a-z0-9_]{2,40}$/;

/** Encola una pieza. LANZA con texto de pantalla en todo rechazo — el agente
 *  que no pudo encolar debe enterarse, no seguir como si hubiera entregado. */
export async function encolarPieza(p: PiezaNueva): Promise<string> {
  if (!TIPO_RE.test(p.tipo)) throw new DatoInvalido('El tipo de pieza va en minúsculas/números/guión bajo (2-40).');
  if (p.prioridad !== 'normal' && p.prioridad !== 'urgente') throw new DatoInvalido('La prioridad es normal o urgente.');
  const titulo = p.titulo.trim();
  const cuerpo = p.cuerpo.trim();
  if (!titulo || titulo.length > 200) throw new DatoInvalido('El título es obligatorio (máx. 200).');
  if (!cuerpo) throw new DatoInvalido('El cuerpo de la pieza es obligatorio — una pieza vacía no tiene qué aprobar.');

  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion').insert({
    tipo: p.tipo, prioridad: p.prioridad, agente: p.agente,
    tenant_id: p.tenantId ?? null, prospecto_id: p.prospectoId ?? null,
    titulo, cuerpo: cuerpo.slice(0, 20_000), fuentes: p.fuentes ?? null,
  }).select('id').single(), 'encolarPieza');
  if (error) {
    // 23503 = el agente no está declarado: la FK es la trazabilidad mínima.
    if (error.code === '23503') throw new DatoInvalido(`El agente "${p.agente}" no está en el catálogo — una pieza sin autor declarado no entra a la cola.`);
    throw new Error(`encolarPieza: ${error.message}`);
  }
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('encolarPieza: el insert no devolvió id');
  return id as string;
}

export interface PiezaEnCola {
  id: string;
  tipo: string;
  prioridad: PrioridadPieza;
  agente: string;
  tenantId: string | null;
  prospectoId: string | null;
  prospectoEmpresa: string | null;
  /** El correo del prospecto — el destinatario del envío, si existe. */
  prospectoCorreo: string | null;
  titulo: string;
  cuerpo: string;
  fuentes: Record<string, unknown> | null;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  cuerpoFinal: string | null;
  motivoRechazo: string | null;
  enviadoEn: string | null;
  providerMessageId: string | null;
  envioError: string | null;
  resueltoPorEmail: string | null;
  creadoEn: string;
}

function desdeFila(f: Record<string, unknown>): PiezaEnCola {
  return {
    id: String(f.id),
    tipo: String(f.tipo),
    prioridad: f.prioridad as PrioridadPieza,
    agente: String(f.agente),
    tenantId: (f.tenant_id as string) ?? null,
    prospectoId: (f.prospecto_id as string) ?? null,
    prospectoEmpresa: ((f.prospecto as { empresa?: string; correo?: string } | null)?.empresa) ?? null,
    prospectoCorreo: ((f.prospecto as { empresa?: string; correo?: string } | null)?.correo) ?? null,
    titulo: String(f.titulo),
    cuerpo: String(f.cuerpo),
    fuentes: (f.fuentes as Record<string, unknown> | null) ?? null,
    estado: f.estado as PiezaEnCola['estado'],
    cuerpoFinal: (f.cuerpo_final as string) ?? null,
    motivoRechazo: (f.motivo_rechazo as string) ?? null,
    enviadoEn: (f.enviado_en as string) ?? null,
    providerMessageId: (f.provider_message_id as string) ?? null,
    envioError: (f.envio_error as string) ?? null,
    resueltoPorEmail: (f.resuelto_por_email as string) ?? null,
    creadoEn: String(f.creado_en),
  };
}

const COLUMNAS = 'id, tipo, prioridad, agente, tenant_id, prospecto_id, titulo, cuerpo, fuentes, estado, cuerpo_final, motivo_rechazo, enviado_en, provider_message_id, envio_error, resuelto_por_email, creado_en, prospecto:prospecto_id(empresa, correo)';

/**
 * UNA bandeja de pendientes, por prioridad — CONSULTA PROPIA por bandeja
 * (auditoría externa P2, 16-ago-2026): la versión anterior traía todos los
 * pendientes en una consulta y filtraba en JS, así que una cola normal
 * enorme —o su lectura caída— arrastraba también a la urgente, que tiene
 * SLA en minutos. Ahora cada bandeja lee, falla y se pinta POR SU LADO.
 * LANZA ante error: vacía-por-base-caída afirmaría "nada espera aprobación".
 */
export async function bandejaPendiente(prioridad: PrioridadPieza): Promise<PiezaEnCola[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('cola_aprobacion')
      .select(COLUMNAS, conteo(d))
      .eq('estado', 'pendiente')
      .eq('prioridad', prioridad)
      .order('creado_en', { ascending: true }).order('id').range(d, h), `bandejaPendiente.${prioridad}`),
    `bandejaPendiente.${prioridad}`,
  );
  return filas.map(desdeFila);
}

/** Las aprobadas que AÚN no se envían — la cola de salida real. */
export async function aprobadasSinEnviar(limite = 20): Promise<PiezaEnCola[]> {
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .select(COLUMNAS)
    .eq('estado', 'aprobado')
    .is('enviado_en', null)
    .order('resuelto_en', { ascending: true })
    .limit(limite), 'aprobadasSinEnviar');
  if (error) throw new Error(`aprobadasSinEnviar: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(desdeFila);
}

/** El SNAPSHOT del actor (0120): la resolución exige saber QUIÉN, y el CHECK
 *  de la base lo re-exige. Si el email no se puede leer, la resolución se
 *  detiene — mejor reintentar que aprobar como nadie. */
async function emailDeActor(actorId: string): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('app_user').select('email').eq('id', actorId).maybeSingle();
  if (error) throw new Error(`emailDeActor: ${error.message}`);
  const email = (data as { email?: string } | null)?.email;
  if (!email) throw new DatoInvalido('No se pudo confirmar quién resuelve — recarga y vuelve a intentar.');
  return email;
}

/** Las últimas resueltas — el contexto de "qué ha estado saliendo". */
export async function ultimasResueltas(limite = 10): Promise<PiezaEnCola[]> {
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .select(COLUMNAS)
    .neq('estado', 'pendiente')
    .order('resuelto_en', { ascending: false })
    .limit(limite), 'ultimasResueltas');
  if (error) throw new Error(`ultimasResueltas: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(desdeFila);
}

/**
 * Aprueba (tal cual o con edición). El UPDATE va anclado a `pendiente`: si
 * otra sesión ya la resolvió, cero filas y SE DICE. `cuerpoFinal` solo se
 * guarda si de verdad difiere del original — un "editado" idéntico mentiría
 * en el aprendizaje de ediciones.
 */
export async function aprobarPieza(id: string, actorId: string, cuerpoEditado?: string): Promise<void> {
  const edicion = cuerpoEditado?.trim();
  const actorEmail = await emailDeActor(actorId);
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({
      estado: 'aprobado',
      cuerpo_final: edicion || null,
      resuelto_por: actorId,
      resuelto_por_email: actorEmail,
      resuelto_en: new Date().toISOString(),
    })
    .eq('id', id).eq('estado', 'pendiente')
    .select('id, cuerpo'), 'aprobarPieza');
  if (error) throw new Error(`aprobarPieza: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Esa pieza ya no está pendiente — alguien la resolvió antes. Recarga la bandeja.');
  }
  // Si la "edición" quedó idéntica al original, se limpia: no hubo edición.
  const original = String((data[0] as Record<string, unknown>).cuerpo ?? '');
  if (edicion && edicion === original.trim()) {
    const { error: errLimpia } = await supabaseAdmin().from('cola_aprobacion')
      .update({ cuerpo_final: null }).eq('id', id);
    if (errLimpia) logger.warn('cola.edicion_identica_no_limpiada', { pieza: id, err: errLimpia.message });
  }
  await anotar('cola.aprobado', id, actorId, { editada: Boolean(edicion && edicion !== original.trim()) });
}

/** Rechaza con motivo OBLIGATORIO (la base también lo exige — CHECK 0117). */
export async function rechazarPieza(id: string, actorId: string, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new DatoInvalido('Rechazar exige un motivo: sin él, la misma pieza se vuelve a proponer igual la próxima vez.');
  const actorEmail = await emailDeActor(actorId);
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({
      estado: 'rechazado', motivo_rechazo: m,
      resuelto_por: actorId, resuelto_por_email: actorEmail,
      resuelto_en: new Date().toISOString(),
    })
    .eq('id', id).eq('estado', 'pendiente')
    .select('id'), 'rechazarPieza');
  if (error) throw new Error(`rechazarPieza: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Esa pieza ya no está pendiente — alguien la resolvió antes. Recarga la bandeja.');
  }
  await anotar('cola.rechazado', id, actorId, { motivo: m.slice(0, 300) });
}

/**
 * Estampa el envío REAL de una pieza aprobada y, si pertenece a un
 * prospecto, deja el contacto en su historial (0118) — es el eslabón que
 * impide que la cadencia se duplique. El CHECK de la base rebota el sello
 * sobre una fila no aprobada aunque este código tuviera un bug.
 */
export async function marcarEnviada(id: string, actorId: string | null, canal: 'correo' | 'linkedin' | 'llamada' | 'whatsapp' | 'presencial' | 'otro' = 'correo'): Promise<void> {
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({ enviado_en: new Date().toISOString() })
    .eq('id', id).eq('estado', 'aprobado').is('enviado_en', null)
    .select('id, prospecto_id, titulo, agente'), 'marcarEnviada');
  if (error) throw new Error(`marcarEnviada: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Solo una pieza APROBADA y aún no enviada se puede marcar como enviada.');
  }
  const fila = data[0] as Record<string, unknown>;
  const prospectoId = (fila.prospecto_id as string) ?? null;
  if (prospectoId) {
    const { error: errContacto } = await supabaseAdmin().from('prospecto_contacto').insert({
      prospecto_id: prospectoId, canal, direccion: 'salida', pieza_id: id,
      resumen: `Salió «${String(fila.titulo).slice(0, 120)}» (${String(fila.agente)}, aprobada en cola).`,
      actor_id: actorId,
    });
    // El envío YA ocurrió: perder el rastro es malo y se GRITA, pero deshacer
    // un envío real por un insert fallido sería peor.
    if (errContacto) logger.error('cola.contacto_no_registrado', { pieza: id, prospecto: prospectoId, err: errContacto.message });
  }
}

/** Bitácora best-effort (criterio interruptores.ts): la acción ya quedó. */
async function anotar(accion: 'cola.aprobado' | 'cola.rechazado', piezaId: string, actorId: string, detalle: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: null, actor_id: actorId, accion,
    entidad: 'cola_aprobacion', entidad_id: piezaId, detalle,
  });
  if (error) logger.warn('cola.bitacora_no_escribio', { accion, pieza: piezaId, err: error.message });
}

// ═══════════════════════════════════════════════════════════════════════════
// EL ENVÍO REAL (0120) — el P1 que la auditoría externa señaló: "aprobada"
// era el final del camino; nada mandaba el correo.
//
// EL ORDEN ES CLAIM → PROVEEDOR → PRUEBA, y no al revés:
//  1. El CLAIM estampa `enviado_en` anclado a (aprobada ∧ no enviada) — dos
//     clicks simultáneos: el segundo toca cero filas y SE DICE. El CHECK de
//     la 0117 re-rebota cualquier fila no aprobada aunque este código
//     tuviera un bug.
//  2. Se manda por Resend (enviarCorreo reporta POR VALOR, jamás lanza).
//  3. Éxito → `provider_message_id` (la prueba de ACEPTADO — no de
//     entregado; delivery/bounce es la capa siguiente, declarada) + el
//     contacto al historial del prospecto (0118).
//     Fallo → COMPENSACIÓN: el claim se revierte y `envio_error` queda — la
//     pieza vuelve a ser enviable con el porqué a la vista. La ventana
//     honesta: si el proceso muere ENTRE el envío y la prueba, la fila queda
//     "enviada sin provider id" — inconsistencia VISIBLE que el panel pinta,
//     no pérdida silenciosa.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoEnvioPieza {
  ok: true;
  destinatario: string;
  providerId: string;
}

export async function enviarPiezaPorCorreo(id: string, actorId: string): Promise<ResultadoEnvioPieza> {
  // 1) EL CLAIM — anclado y con todo lo necesario para mandar en el RETURNING:
  //    releer después del claim abriría la ventana que el claim cierra.
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({ enviado_en: new Date().toISOString(), envio_error: null })
    .eq('id', id).eq('estado', 'aprobado').is('enviado_en', null)
    .select('id, titulo, cuerpo, cuerpo_final, agente, prioridad, prospecto_id, prospecto:prospecto_id(empresa, correo)'), 'enviarPiezaPorCorreo.claim');
  if (error) throw new Error(`enviarPiezaPorCorreo: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Solo una pieza APROBADA y aún no enviada se puede enviar — puede que otro click le ganara a este. Recarga.');
  }
  const fila = data[0] as Record<string, unknown>;
  const prospecto = fila.prospecto as { empresa?: string; correo?: string } | null;
  const destinatario = prospecto?.correo?.trim() ?? '';

  const revertir = async (motivo: string) => {
    const { error: errRevertir } = await supabaseAdmin().from('cola_aprobacion')
      .update({ enviado_en: null, envio_error: motivo.slice(0, 300) })
      .eq('id', id);
    // Si NI la compensación entra, la fila queda "enviada" sin provider id —
    // la inconsistencia visible que el panel pinta. Se grita.
    if (errRevertir) logger.error('cola.envio_sin_revertir', { pieza: id, motivo, err: errRevertir.message });
  };

  if (!destinatario) {
    await revertir('El prospecto no tiene correo capturado.');
    throw new DatoInvalido('El prospecto de esta pieza no tiene correo capturado — captúralo en Vendedores y vuelve a enviar.');
  }

  // ── LA GUARDIA DE CADENCIA (auditoría externa P2): el historial 0118 no
  // impide nada por existir — lo impide LEERSE antes de enviar. Un lead del
  // censo es finito: dos correos en menos de 48 h lo queman. La regla vive
  // aquí, en la única puerta de salida, no en la buena voluntad del agente
  // que redactó. Si el historial NO SE PUEDE leer, no se manda (fail
  // closed): enviar a ciegas es exactamente el duplicado que se persigue.
  const prospectoIdGuardia = (fila.prospecto_id as string) ?? null;
  if (prospectoIdGuardia) {
    const hace48h = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const { data: recientes, error: errHistorial } = await supabaseAdmin()
      .from('prospecto_contacto')
      .select('ocurrio_en')
      .eq('prospecto_id', prospectoIdGuardia)
      .eq('direccion', 'salida')
      .gte('ocurrio_en', hace48h)
      .limit(1);
    if (errHistorial) {
      await revertir('No se pudo leer el historial de contactos.');
      throw new DatoInvalido('No se pudo consultar el historial del prospecto — sin él no se manda (la cadencia no se verifica a ciegas). Reintenta.');
    }
    if ((recientes ?? []).length > 0) {
      await revertir('Contactado hace menos de 48 h — la cadencia lo protege.');
      throw new DatoInvalido('A este prospecto ya se le escribió hace menos de 48 horas — la cadencia mínima lo protege. La pieza sigue aprobada; reintenta cuando pase la ventana.');
    }
  }

  // ── EL TOPE DIARIO (Fase 2: "20–40 correos aprobados/día, máximo") ──
  // Solo la prospección NORMAL cuenta contra el techo; la bandeja urgente
  // (ads-respuesta) NO — su SLA se mide en minutos y el techo es de
  // reputación de dominio para el FRÍO (panel-de-adquisicion §3, que ya
  // decidió que lo urgente no cuenta). Fail closed: sin la lectura del
  // conteo, no se manda — el día es el DE MÉXICO, no el UTC.
  if ((fila.prioridad as string) === 'normal') {
    const tope = topeCorreoFrioDia();
    const diaMx = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX }).format(new Date());
    const inicioDia = new Date(`${diaMx}T00:00:00-06:00`).toISOString();
    const { count, error: errTope } = await supabaseAdmin()
      .from('cola_aprobacion')
      .select('id', { count: 'exact', head: true })
      .eq('prioridad', 'normal')
      .not('enviado_en', 'is', null)
      .gte('enviado_en', inicioDia);
    if (errTope || typeof count !== 'number') {
      await revertir('No se pudo verificar el tope diario de envíos.');
      throw new DatoInvalido('No se pudo verificar el tope diario de envíos — sin esa lectura no se manda. Reintenta.');
    }
    // El claim de ESTA pieza ya estampó su enviado_en, así que ella misma
    // viene en `count`: el tope se compara contra los DEMÁS envíos de hoy.
    if (count - 1 >= tope) {
      await revertir(`Tope diario de correo frío alcanzado (${tope}).`);
      throw new DatoInvalido(`Hoy ya salieron ${tope} correos fríos — el tope diario protege la reputación del dominio (ajustable: LIKIDA_TOPE_CORREO_FRIO_DIA). La pieza sigue aprobada; sale mañana.`);
    }
  }

  // 2) EL PROVEEDOR. Sale la versión FINAL (la edición humana manda).
  const cuerpo = String(fila.cuerpo_final ?? fila.cuerpo);
  const r = await enviarCorreo(destinatario, {
    asunto: String(fila.titulo),
    avance: cuerpo.slice(0, 90),
    titulo: String(fila.titulo),
    parrafos: cuerpo.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 12),
    porQueLoRecibes: 'Recibes este correo porque tu empresa publicó una vacante relacionada con liquidación de viajes.',
  });
  if (!r.ok) {
    const motivo = r.motivo === 'sin_configurar'
      ? 'El canal de correo no está configurado (RESEND_API_KEY/RESEND_EMAIL_DOMAIN).'
      : `Resend no aceptó el envío (${r.motivo}: ${'detalle' in r ? r.detalle : ''}).`;
    await revertir(motivo);
    throw new DatoInvalido(`${motivo} La pieza sigue aprobada y se puede reintentar.`);
  }

  // 3) LA PRUEBA + el historial del prospecto.
  const { error: errPrueba } = await supabaseAdmin().from('cola_aprobacion')
    .update({ provider_message_id: r.id || 'aceptado-sin-id' })
    .eq('id', id);
  if (errPrueba) logger.error('cola.provider_id_sin_guardar', { pieza: id, providerId: r.id, err: errPrueba.message });

  const prospectoId = (fila.prospecto_id as string) ?? null;
  if (prospectoId) {
    const { error: errContacto } = await supabaseAdmin().from('prospecto_contacto').insert({
      prospecto_id: prospectoId, canal: 'correo', direccion: 'salida', pieza_id: id,
      resumen: `Salió «${String(fila.titulo).slice(0, 120)}» por correo (${String(fila.agente)}, aprobada en cola).`,
      actor_id: actorId,
    });
    if (errContacto) logger.error('cola.contacto_no_registrado', { pieza: id, prospecto: prospectoId, err: errContacto.message });
  }
  return { ok: true, destinatario, providerId: r.id || 'aceptado-sin-id' };
}


/**
 * Las piezas URGENTES que llevan más de `minutos` esperando — el monitor de
 * SLA que la auditoría externa pidió: una urgente se mide en minutos, y sin
 * esta lectura nadie se entera de que envejecen. La consume el heartbeat de
 * 5 minutos (cron wa-pendientes). LANZA ante error: "0 vencidas" con la
 * base caída sería la mentira exacta que el SLA existe para evitar.
 */
export async function urgentesVencidas(minutos = 10): Promise<number> {
  const corte = new Date(Date.now() - minutos * 60_000).toISOString();
  const { count, error } = await supabaseAdmin()
    .from('cola_aprobacion')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente')
    .eq('prioridad', 'urgente')
    .lte('creado_en', corte);
  if (error) throw new Error(`urgentesVencidas: ${error.message}`);
  if (typeof count !== 'number') throw new Error('urgentesVencidas: la base no devolvió el conteo');
  return count;
}
