// ═══════════════════════════════════════════════════════════════════════════
// El historial persistente del Copiloto del fundador (0121, 16-ago-2026).
//
// ESPEJO DELIBERADO de lib/likida/chat/conversaciones.ts (0088), menos el
// tenant: el copiloto es de LIKIDA, no de una flota — el ancla es SOLO el
// usuario. TODA función ancla `user_id`: un `conversacionId` ajeno mandado
// por el cliente simplemente no encuentra fila (el IDOR muere aquí, no en el
// cliente). La puerta de ROL (solo superadmin) no vive aquí: vive en
// /api/admin/copiloto, el único caller — este módulo confía en su puerta
// igual que conversaciones.ts confía en la del chat.
//
// La escritura vive en el MISMO endpoint que ya respondió: no hay un
// "guardar" que el cliente pueda saltarse u olvidar. Si guardar falla, la
// respuesta igual sale — el historial es una comodidad; la respuesta ya
// costó dinero.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { tituloDeConversacion } from '@/lib/likida/chat/conversaciones';

export interface ConversacionCopilotoResumen {
  id: string;
  titulo: string;
  actualizadoEn: string;
}

export interface MensajeCopilotoGuardado {
  rol: 'usuario' | 'asistente';
  texto: string;
  /** Los bloques crudos del copiloto (para re-pintar visuales). NULL en los
   *  mensajes del usuario y en respuestas sin bloques. */
  bloques: Array<Record<string, unknown>> | null;
}

const MAX_LISTA = 100;

/** Las conversaciones del usuario, la más reciente primero. Lanza si la base
 *  no responde — una lista vacía por error afirmaría "no has chateado". */
export async function listarConversacionesCopiloto(userId: string): Promise<ConversacionCopilotoResumen[]> {
  const { data, error } = await acotada(
    supabaseAdmin().from('copiloto_conversacion')
      .select('id, titulo, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(MAX_LISTA),
    'copiloto.listar_conversaciones');
  if (error) throw new Error(`listarConversacionesCopiloto: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    titulo: f.titulo as string,
    actualizadoEn: f.updated_at as string,
  }));
}

/** Una conversación completa — o `null` si no existe O no es de este usuario
 *  (indistinguibles a propósito). */
export async function traerConversacionCopiloto(
  userId: string, id: string,
): Promise<{ id: string; titulo: string; mensajes: MensajeCopilotoGuardado[] } | null> {
  const { data: conv, error } = await acotada(
    supabaseAdmin().from('copiloto_conversacion')
      .select('id, titulo')
      .eq('id', id).eq('user_id', userId)
      .maybeSingle(),
    'copiloto.traer_conversacion');
  if (error) throw new Error(`traerConversacionCopiloto: ${error.message}`);
  if (!conv) return null;

  const { data: msjs, error: errMsjs } = await acotada(
    supabaseAdmin().from('copiloto_mensaje')
      .select('rol, texto, bloques')
      .eq('conversacion_id', id)
      .order('created_at', { ascending: true })
      .limit(200),
    'copiloto.traer_mensajes');
  if (errMsjs) throw new Error(`traerConversacionCopiloto.mensajes: ${errMsjs.message}`);

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
export async function guardarIntercambioCopiloto({
  userId, conversacionId, pregunta, textoRespuesta, bloques,
}: {
  userId: string;
  conversacionId: string | null;
  pregunta: string;
  textoRespuesta: string;
  bloques: Array<Record<string, unknown>>;
}): Promise<string> {
  let id = conversacionId;

  if (id) {
    const { data, error } = await acotada(
      supabaseAdmin().from('copiloto_conversacion')
        .select('id')
        .eq('id', id).eq('user_id', userId)
        .maybeSingle(),
      'copiloto.verificar_conversacion');
    if (error) throw new Error(`guardarIntercambioCopiloto.verificar: ${error.message}`);
    if (!data) id = null;
  }

  if (!id) {
    const { data, error } = await acotada(
      supabaseAdmin().from('copiloto_conversacion')
        .insert({ user_id: userId, titulo: tituloDeConversacion(pregunta) })
        .select('id')
        .single(),
      'copiloto.crear_conversacion');
    if (error || !data) throw new Error(`guardarIntercambioCopiloto.crear: ${error?.message ?? 'sin fila'}`);
    id = data.id as string;
  }

  const { error: errMsjs } = await acotada(
    supabaseAdmin().from('copiloto_mensaje').insert([
      { conversacion_id: id, rol: 'usuario', texto: pregunta.slice(0, 4_000), bloques: null },
      { conversacion_id: id, rol: 'asistente', texto: textoRespuesta.slice(0, 8_000), bloques },
    ]),
    'copiloto.guardar_mensajes');
  if (errMsjs) throw new Error(`guardarIntercambioCopiloto.mensajes: ${errMsjs.message}`);

  const { error: errToca } = await acotada(
    supabaseAdmin().from('copiloto_conversacion')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', userId),
    'copiloto.tocar_conversacion');
  if (errToca) throw new Error(`guardarIntercambioCopiloto.tocar: ${errToca.message}`);

  return id;
}
