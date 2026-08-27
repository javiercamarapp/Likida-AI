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
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { DatoInvalido } from '../errores';
import { logger } from '@/lib/logger';
import { enviarCorreo } from '@/lib/correo/enviar';
import { hoyMx } from '@/lib/formato';

/** El tope de correos FRÍOS aprobados por día (Fase 2: "20–40, máximo" —
 *  reputación del dominio + lo que el embudo humano digiere). Vive en
 *  config (env), no hardcodeado, para ajustarse sin tocar código. */
export function topeCorreoFrioDia(): number {
  const v = Number(process.env.LIKIDA_TOPE_CORREO_FRIO_DIA);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
}

/** Los tipos de pieza que son CAMPAÑA de prospección — los únicos que el
 *  enviador auto-resuelve y los únicos cuyo texto pasa por el verificador
 *  estructural también al ENVIAR (c5-14: la edición humana no lo esquiva). */
export const TIPOS_CAMPANA = ['correo_frio', 'correo_seguimiento'] as const;

/** El verificador ESTRUCTURAL del formato de campaña — los dos guardarraíles
 *  cazados en vivo: jamás "clientes reales" (ninguna empresa ha firmado; la
 *  frase permitida es "en pláticas con...") y sin guiones largos. Es código,
 *  no prompt. Vive AQUÍ (y no en redactor.ts, que lo re-exporta) porque la
 *  puerta de salida también lo aplica (c5-14): una edición humana o una
 *  variante guardada que lo viole tampoco sale. */
export function verificarFormatoCampana(texto: string): void {
  if (/clientes?\s+reales/i.test(texto)) {
    throw new DatoInvalido('El correo dice "clientes reales" — ninguna empresa ha firmado; la frase permitida es "en pláticas con transportistas como...". Pieza descartada.');
  }
  if (texto.includes('—')) {
    throw new DatoInvalido('El correo trae guion largo (—) — el formato de campaña los prohíbe. Pieza descartada.');
  }
}

/** La lista de bajas, FAIL-CLOSED: si no se puede leer, LANZA — mandar sin
 *  consultar las bajas es escribirle a quien pidió que no. Vive AQUÍ (c5-1)
 *  porque la consulta pertenece a la PUERTA de salida, no a un llamador: el
 *  camino humano de /admin/aprobaciones la ignoraba y un correo suprimido
 *  por queja de spam podía volver a recibir campaña con un click. */
export async function filtrarSuprimidos(correos: string[]): Promise<string[]> {
  const limpios = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (limpios.length === 0) return [];
  const { data, error } = await acotada(supabaseAdmin()
    .from('correo_suprimido')
    .select('correo')
    .in('correo', limpios), 'cola.suprimidos');
  if (error) throw new Error(`filtrarSuprimidos: ${error.message}`);
  const fuera = new Set(((data ?? []) as Array<{ correo: string }>).map((f) => f.correo));
  return limpios.filter((c) => !fuera.has(c));
}

/**
 * El pie "por qué recibes esto", derivado de la FUENTE REAL del prospecto
 * (c5-5): el texto anterior afirmaba «tu empresa publicó una vacante» a TODO
 * destinatario — incluido el que llegó por la calculadora y el del censo sin
 * vacante capturada. Afirmar una vacante que no consta es inventar un hecho.
 * Exportada para su prueba.
 */
export function porQueLoRecibes(fuente: string | null, vacante: string | null): string {
  const baja = 'Si prefieres no recibir estos correos, responde con la palabra BAJA y no volveremos a escribirte.';
  if (vacante?.trim()) {
    return `Recibes este correo porque tu empresa publicó una vacante relacionada con liquidación de viajes. ${baja}`;
  }
  if (fuente === 'landing') {
    return `Recibes este correo porque usaste nuestra calculadora de recuperación fiscal en likida.ai. ${baja}`;
  }
  return `Recibes este correo porque tu empresa aparece en directorios públicos del autotransporte en México. ${baja}`;
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
  /** Lo que el PROVEEDOR reportó tras aceptar (webhook 0124): entregado /
   *  rebotado / queja. `null` = aceptado sin noticia todavía — la pantalla
   *  lo distingue de "entregado". */
  entregaEstado: 'entregado' | 'rebotado' | 'queja' | null;
  entregaEventoEn: string | null;
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
    entregaEstado: (f.entrega_estado as PiezaEnCola['entregaEstado']) ?? null,
    entregaEventoEn: (f.entrega_evento_en as string) ?? null,
    resueltoPorEmail: (f.resuelto_por_email as string) ?? null,
    creadoEn: String(f.creado_en),
  };
}

const COLUMNAS = 'id, tipo, prioridad, agente, tenant_id, prospecto_id, titulo, cuerpo, fuentes, estado, cuerpo_final, motivo_rechazo, enviado_en, provider_message_id, envio_error, entrega_estado, entrega_evento_en, resuelto_por_email, creado_en, prospecto:prospecto_id(empresa, correo)';

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
  await anotarBitacora(
    { tenantId: null, actor: { id: actorId }, accion, entidad: 'cola_aprobacion', entidadId: piezaId, detalle },
    { evento: 'cola.bitacora_no_escribio', contexto: { pieza: piezaId } },
  );
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

export async function enviarPiezaPorCorreo(
  id: string,
  /** `null` = envío AUTOMÁTICO del Enviador (0217, orden del 27-ago): la
   *  reserva de cadencia queda sin actor humano — la pieza ya dice qué
   *  agente la fabricó y la resolución quién (o qué) la aprobó. */
  actorId: string | null,
  /** Copias del MISMO correo a los demás correos hallados de la empresa
   *  (prospecto_correo, ya filtrados de suprimidos por el llamador). Van en
   *  el mismo envío y bajo la misma reserva de cadencia: para la empresa es
   *  UN toque, no uno por buzón. */
  copias: string[] = [],
): Promise<ResultadoEnvioPieza> {
  // 1) EL CLAIM — anclado y con todo lo necesario para mandar en el RETURNING:
  //    releer después del claim abriría la ventana que el claim cierra.
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .update({ enviado_en: new Date().toISOString(), envio_error: null })
    .eq('id', id).eq('estado', 'aprobado').is('enviado_en', null)
    .select('id, tipo, titulo, cuerpo, cuerpo_final, agente, prioridad, prospecto_id, prospecto:prospecto_id(empresa, correo, fuente, vacante)'), 'enviarPiezaPorCorreo.claim');
  if (error) throw new Error(`enviarPiezaPorCorreo: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Solo una pieza APROBADA y aún no enviada se puede enviar — puede que otro click le ganara a este. Recarga.');
  }
  const fila = data[0] as Record<string, unknown>;
  const prospecto = fila.prospecto as { empresa?: string; correo?: string; fuente?: string; vacante?: string } | null;
  const destinatario = prospecto?.correo?.trim() ?? '';
  const esCampana = (TIPOS_CAMPANA as readonly string[]).includes(String(fila.tipo));

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

  // ── EL FORMATO DE CAMPAÑA, EN LA PUERTA (c5-14) ──────────────────────────
  // El texto que de verdad va a salir (la edición humana manda) se verifica
  // AQUÍ, no solo al fabricarse: un `cuerpo_final` editado a mano con
  // "clientes reales" o un guion largo tampoco sale.
  const cuerpo = String(fila.cuerpo_final ?? fila.cuerpo);
  if (esCampana) {
    try {
      verificarFormatoCampana(String(fila.titulo));
      verificarFormatoCampana(cuerpo);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      await revertir(motivo);
      throw new DatoInvalido(motivo);
    }
  }

  // ── LA LISTA DE BAJAS, EN LA PUERTA Y FAIL-CLOSED (c5-1) ─────────────────
  // Cubre el camino humano Y el automático: si la lista no se puede leer, no
  // se manda; si el principal está suprimido, la pieza no sale y SE DICE.
  // Las copias suprimidas simplemente se caen del envío.
  let vivos: string[];
  try {
    vivos = await filtrarSuprimidos([destinatario, ...copias]);
  } catch {
    await revertir('No se pudo leer la lista de bajas.');
    throw new DatoInvalido('No se pudo leer la lista de bajas — sin esa lectura no se manda (escribirle a quien pidió baja quema el dominio). Reintenta.');
  }
  if (!vivos.includes(destinatario.trim().toLowerCase())) {
    await revertir('El correo principal está en la lista de bajas.');
    throw new DatoInvalido('El correo principal de este prospecto está en la lista de bajas — pidió que no se le escribiera (o rebotó). No se envía.');
  }

  // ── EL TOPE DIARIO (Fase 2: "20–40 correos aprobados/día, máximo") ──
  // Solo la prospección NORMAL cuenta contra el techo; la bandeja urgente
  // (ads-respuesta) NO — su SLA se mide en minutos y el techo es de
  // reputación de dominio para el FRÍO (panel-de-adquisicion §3, que ya
  // decidió que lo urgente no cuenta). Fail closed: sin la lectura del
  // conteo, no se manda — el día es el DE MÉXICO, no el UTC.
  if ((fila.prioridad as string) === 'normal') {
    const tope = topeCorreoFrioDia();
    const diaMx = hoyMx();
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

  // ── LA GUARDIA DE CADENCIA, ATÓMICA (0124 — auditoría externa 2): la
  // versión anterior hacía SELECT historial → enviar → INSERT, con el claim
  // sobre la PIEZA: dos piezas del MISMO prospecto podían ver ambas «cero
  // contactos» y salir las dos. Ahora la decisión es UNA transacción en la
  // base (`reservar_envio_prospecto`: advisory lock por prospecto +
  // verificación + INSERT de la reserva) — la segunda serializa detrás de
  // la primera y rebota. Fail closed: si la RPC no responde, no se manda.
  const prospectoIdGuardia = (fila.prospecto_id as string) ?? null;
  let reservaId: string | null = null;
  if (prospectoIdGuardia) {
    const { data: reserva, error: errReserva } = await supabaseAdmin()
      .rpc('reservar_envio_prospecto', {
        p_prospecto: prospectoIdGuardia,
        p_pieza: id,
        p_actor: actorId,
        p_resumen: `Salió «${String(fila.titulo).slice(0, 120)}» por correo (${String(fila.agente)}, aprobada en cola).`,
        p_horas: 48,
      });
    if (errReserva) {
      await revertir('No se pudo reservar la cadencia del prospecto.');
      throw new DatoInvalido('No se pudo verificar la cadencia del prospecto — sin esa reserva no se manda (¿migración 0124 aplicada?). Reintenta.');
    }
    if (reserva === null) {
      await revertir('Contactado hace menos de 48 h — la cadencia lo protege.');
      throw new DatoInvalido('A este prospecto ya se le escribió hace menos de 48 horas — la cadencia mínima lo protege. La pieza sigue aprobada; reintenta cuando pase la ventana.');
    }
    reservaId = String(reserva);
  }

  // 2) EL PROVEEDOR. Sale la versión FINAL (la edición humana manda). Las
  // copias van en el MISMO envío (Resend acepta lista) — la lista ya pasó
  // por bajas (c5-1) y se deduplica contra el principal. La instrucción de
  // BAJA va en el pie de todos: la honra el procesamiento de respuestas
  // (correo/entrante) y la lista `correo_suprimido` (0217). El pie dice POR
  // QUÉ recibe el correo según la fuente real del prospecto (c5-5) — jamás
  // una vacante que no consta. La llave de idempotencia es el id de la pieza
  // (c5-3): un reintento tras timeout ambiguo no duplica el correo.
  const paraTodos = [destinatario, ...vivos
    .filter((c) => c !== destinatario.trim().toLowerCase())];
  const r = await enviarCorreo(paraTodos, {
    asunto: String(fila.titulo),
    avance: cuerpo.slice(0, 90),
    titulo: String(fila.titulo),
    parrafos: cuerpo.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 12),
    porQueLoRecibes: porQueLoRecibes(prospecto?.fuente ?? null, prospecto?.vacante ?? null),
  }, { idempotencyKey: `pieza-${id}` });
  if (!r.ok) {
    // ── LA AMBIGÜEDAD DE RED (c5-3) ────────────────────────────────────────
    // 'red' incluye el timeout: el POST pudo haber sido ACEPTADO con la
    // respuesta perdida. Revertir aquí trataría "no sé" como "no salió" y el
    // reintento mandaría el MISMO correo frío otra vez al mismo contacto.
    // La pieza queda con su claim puesto y el motivo a la vista ("verificar
    // en Resend"): jamás reenvío automático; el humano verifica y, si de
    // verdad no salió, el reintento es seguro por la Idempotency-Key.
    // La reserva de cadencia TAMPOCO se borra: bloquear 48h de más es el
    // lado seguro cuando no se sabe si el correo llegó.
    if (r.motivo === 'red') {
      const detalle = `AMBIGUO: el proveedor no contestó a tiempo (${'detalle' in r ? r.detalle : 'timeout'}) — el correo PUDO haber salido. Verificar en Resend antes de cualquier reenvío.`;
      const { error: errAmb } = await supabaseAdmin().from('cola_aprobacion')
        .update({ envio_error: detalle.slice(0, 300) })
        .eq('id', id);
      if (errAmb) logger.error('cola.ambiguo_sin_anotar', { pieza: id, err: errAmb.message });
      logger.warn('cola.envio_ambiguo', { pieza: id, detalle });
      throw new DatoInvalido(`${detalle} La pieza queda marcada como enviada-por-confirmar en el panel.`);
    }
    const motivo = r.motivo === 'sin_configurar'
      ? 'El canal de correo no está configurado (RESEND_API_KEY/RESEND_EMAIL_DOMAIN).'
      : `Resend no aceptó el envío (${r.motivo}: ${'detalle' in r ? r.detalle : ''}).`;
    // La COMPENSACIÓN de la reserva (0124), SOLO ante rechazo DEFINITIVO: el
    // proveedor dijo que no, así que el contacto reservado se borra —
    // dejarlo bloquearía 48h de cadencia por un correo que nunca salió. Si
    // NI borrarla se puede, queda del lado seguro (bloquea de más, jamás de
    // menos) y se grita.
    if (reservaId) {
      const { error: errComp } = await supabaseAdmin()
        .from('prospecto_contacto').delete().eq('id', reservaId);
      if (errComp) logger.error('cola.reserva_sin_compensar', { pieza: id, reserva: reservaId, err: errComp.message });
    }
    await revertir(motivo);
    throw new DatoInvalido(`${motivo} La pieza sigue aprobada y se puede reintentar.`);
  }

  // 3) LA PRUEBA. El contacto del historial YA existe: es la reserva de la
  // cadencia (0124) — insertarlo aquí otra vez duplicaría el historial.
  const { error: errPrueba } = await supabaseAdmin().from('cola_aprobacion')
    .update({ provider_message_id: r.id || 'aceptado-sin-id' })
    .eq('id', id);
  if (errPrueba) logger.error('cola.provider_id_sin_guardar', { pieza: id, providerId: r.id, err: errPrueba.message });

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
