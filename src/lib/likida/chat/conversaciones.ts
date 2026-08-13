// ═══════════════════════════════════════════════════════════════════════════
// El historial persistente de "Chatea con tus datos" (0088, 13-ago-2026).
//
// Una conversación es de UN usuario en UN tenant. TODA función de este módulo
// ancla `tenant_id` Y `user_id` — el contador no lee los chats del dueño, y
// un `conversacionId` ajeno mandado por el cliente simplemente no encuentra
// fila (el IDOR muere aquí, no en el cliente).
//
// La escritura vive en el MISMO endpoint que ya respondió (chat/route.ts):
// no hay un "guardar" que el cliente pueda saltarse u olvidar. Si guardar
// falla, la respuesta igual sale — el historial es una comodidad; la
// respuesta ya costó dinero.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

export interface ConversacionResumen {
  id: string;
  titulo: string;
  actualizadoEn: string;
}

export interface MensajeGuardado {
  rol: 'usuario' | 'asistente';
  texto: string;
  /** Los bloques crudos del analista (para re-pintar visuales). NULL en los
   *  mensajes del usuario y en respuestas sin bloques. */
  bloques: Array<Record<string, unknown>> | null;
}

export const MAX_TITULO = 60;

/** El rótulo de la conversación: su primera pregunta, en una línea y
 *  recortada. Nunca vacío — un botón sin texto no se puede encontrar. */
export function tituloDeConversacion(pregunta: string): string {
  const limpio = pregunta.replace(/\s+/g, ' ').trim();
  if (!limpio) return 'Conversación';
  return limpio.length > MAX_TITULO ? `${limpio.slice(0, MAX_TITULO - 1)}…` : limpio;
}

const MAX_LISTA = 100;

/** Las conversaciones del usuario, la más reciente primero. Lanza si la base
 *  no responde — una lista vacía por error afirmaría "no has chateado". */
export async function listarConversaciones(tenantId: string, userId: string): Promise<ConversacionResumen[]> {
  const { data, error } = await acotada(
    supabaseAdmin().from('chat_conversacion')
      .select('id, titulo, updated_at')
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(MAX_LISTA),
    'chat.listar_conversaciones');
  if (error) throw new Error(`listarConversaciones: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    titulo: f.titulo as string,
    actualizadoEn: f.updated_at as string,
  }));
}

/** Una conversación completa — o `null` si no existe O no es de este usuario
 *  en este tenant (indistinguibles a propósito). */
export async function traerConversacion(
  tenantId: string, userId: string, id: string,
): Promise<{ id: string; titulo: string; mensajes: MensajeGuardado[] } | null> {
  const { data: conv, error } = await acotada(
    supabaseAdmin().from('chat_conversacion')
      .select('id, titulo')
      .eq('id', id).eq('tenant_id', tenantId).eq('user_id', userId)
      .maybeSingle(),
    'chat.traer_conversacion');
  if (error) throw new Error(`traerConversacion: ${error.message}`);
  if (!conv) return null;

  const { data: msjs, error: errMsjs } = await acotada(
    supabaseAdmin().from('chat_mensaje')
      .select('rol, texto, bloques')
      .eq('conversacion_id', id)
      .order('created_at', { ascending: true })
      .limit(200),
    'chat.traer_mensajes');
  if (errMsjs) throw new Error(`traerConversacion.mensajes: ${errMsjs.message}`);

  return {
    id: conv.id as string,
    titulo: conv.titulo as string,
    mensajes: (msjs ?? []).map((m) => ({
      rol: m.rol as 'usuario' | 'asistente',
      texto: m.texto as string,
      bloques: Array.isArray(m.bloques) ? (m.bloques as Array<Record<string, unknown>>) : null,
    })),
  };
}

/**
 * Guarda un intercambio (pregunta + respuesta) y devuelve el id de la
 * conversación. Si `conversacionId` viene y ES del usuario, se le anexa;
 * si viene y no lo es (o ya no existe), se abre una NUEVA — fallar cerrado:
 * jamás se escribe en la conversación de otro.
 */
export async function guardarIntercambio({
  tenantId, userId, conversacionId, pregunta, textoRespuesta, bloques,
}: {
  tenantId: string;
  userId: string;
  conversacionId: string | null;
  pregunta: string;
  textoRespuesta: string;
  bloques: Array<Record<string, unknown>>;
}): Promise<string> {
  let id = conversacionId;

  if (id) {
    const { data, error } = await acotada(
      supabaseAdmin().from('chat_conversacion')
        .select('id')
        .eq('id', id).eq('tenant_id', tenantId).eq('user_id', userId)
        .maybeSingle(),
      'chat.verificar_conversacion');
    if (error) throw new Error(`guardarIntercambio.verificar: ${error.message}`);
    if (!data) id = null;
  }

  if (!id) {
    const { data, error } = await acotada(
      supabaseAdmin().from('chat_conversacion')
        .insert({ tenant_id: tenantId, user_id: userId, titulo: tituloDeConversacion(pregunta) })
        .select('id')
        .single(),
      'chat.crear_conversacion');
    if (error || !data) throw new Error(`guardarIntercambio.crear: ${error?.message ?? 'sin fila'}`);
    id = data.id as string;
  }

  const { error: errMsjs } = await acotada(
    supabaseAdmin().from('chat_mensaje').insert([
      { conversacion_id: id, rol: 'usuario', texto: pregunta.slice(0, 4_000), bloques: null },
      { conversacion_id: id, rol: 'asistente', texto: textoRespuesta.slice(0, 8_000), bloques },
    ]),
    'chat.guardar_mensajes');
  if (errMsjs) throw new Error(`guardarIntercambio.mensajes: ${errMsjs.message}`);

  const { error: errToca } = await acotada(
    supabaseAdmin().from('chat_conversacion')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', tenantId).eq('user_id', userId),
    'chat.tocar_conversacion');
  if (errToca) throw new Error(`guardarIntercambio.tocar: ${errToca.message}`);

  return id;
}
