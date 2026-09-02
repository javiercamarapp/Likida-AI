// ═══════════════════════════════════════════════════════════════════════════
// LA RESPUESTA A UN CORREO DE CAMPAÑA (c5-2) — la promesa del pie, cumplida.
//
// Todo correo de campaña sale de `avisos@<dominio>` con el pie «responde con
// la palabra BAJA y no volveremos a escribirte». Hasta este módulo, esa
// promesa era MENTIRA: el webhook de correo entrante descartaba como
// `sin_buzon` cualquier respuesta (solo entendía los buzones-token de las
// flotas), nadie escribía `direccion:'respuesta'` en el historial — así que
// el freno del SDR era código muerto — y la BAJA no suprimía nada: quien la
// pedía recibía los seguimientos +3/+7 igual.
//
// Qué hace, en orden:
//   1. Detecta la BAJA en asunto o cuerpo (palabra completa, sin importar
//      mayúsculas) y suprime la dirección PARA SIEMPRE — incluso si el
//      remitente no matchea ningún prospecto: la baja es de la persona, no
//      de nuestra contabilidad.
//   2. Registra `direccion:'respuesta'` en el historial del prospecto (0118)
//      — eso detiene la cadencia del SDR, que ya la miraba.
//   3. Avisa al operador: el cierre es humano; la máquina jamás contesta una
//      respuesta.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { suprimirCorreo } from '@/lib/likida/agentes/enviador';
import { alertarOperador } from '@/lib/observability/alerta';
import { logger } from '@/lib/logger';

/** El buzón del que sale la campaña (enviar.ts, remitente local 'avisos'). */
export function direccionDeCampana(): string | null {
  const dominio = process.env.RESEND_EMAIL_DOMAIN;
  return dominio ? `avisos@${dominio}`.toLowerCase() : null;
}

const RE_CORREO = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** El correo pelón de un encabezado From/To ("Nombre <a@b>" o "a@b"). */
export function extraerCorreo(encabezado: string | undefined | null): string | null {
  const m = (encabezado ?? '').match(RE_CORREO);
  return m ? m[0].toLowerCase() : null;
}

/** ¿Alguno de los destinatarios es el buzón de campaña? Exportada para su
 *  prueba: es la llave que separa «respuesta a la campaña» de «correo de
 *  facturas de una flota» en el mismo webhook. */
export function esRespuestaACampana(destinatarios: readonly string[], buzonCampana: string): boolean {
  return destinatarios.some((d) => extraerCorreo(d) === buzonCampana);
}

/** ¿El texto pide la BAJA? Palabra COMPLETA (con o sin texto alrededor) en
 *  el asunto o en el cuerpo — «necesito darme de baja» cuenta; «trabaja»
 *  no. También la variante en inglés que los clientes de correo insertan. */
export function esBaja(asunto: string | null, cuerpo: string | null): boolean {
  const texto = `${asunto ?? ''}\n${(cuerpo ?? '').slice(0, 4_000)}`;
  return /\bbaja\b/i.test(texto) || /\bunsubscribe\b/i.test(texto);
}

/** El texto visible de un cuerpo que puede venir en HTML. */
function textoPlano(texto: string | undefined, html: string | undefined): string {
  if (texto?.trim()) return texto;
  return (html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

export interface RespuestaCampanaEvento {
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export type ResultadoRespuesta =
  | { ok: true; resultado: 'respuesta_registrada' | 'baja_registrada' | 'baja_sin_prospecto' | 'respuesta_sin_prospecto' | 'sin_remitente' }
  /** El historial no se pudo escribir: el llamador contesta 503 para que el
   *  proveedor reintente — perder la respuesta deja al SDR insistiéndole a
   *  quien ya contestó. La supresión de una BAJA es idempotente, así que el
   *  reintento no duplica nada que importe. */
  | { ok: false; motivo: string };

/**
 * Procesa UNA respuesta al buzón de campaña. La supresión va PRIMERO (la
 * promesa del pie no puede depender de que encontremos al prospecto); el
 * historial después; el aviso al operador al final, best-effort.
 */
export async function procesarRespuestaCampana(d: RespuestaCampanaEvento): Promise<ResultadoRespuesta> {
  const remitente = extraerCorreo(d.from);
  if (!remitente) return { ok: true, resultado: 'sin_remitente' };

  const asunto = (d.subject ?? '').slice(0, 200);
  const cuerpo = textoPlano(d.text, d.html);
  const baja = esBaja(asunto, cuerpo);
  if (baja) await suprimirCorreo(remitente, 'baja pedida (respuesta de campaña)');

  // El prospecto: por su correo principal o por cualquiera de los hallados.
  let prospectoId: string | null = null;
  const { data: porPrincipal, error: errPrincipal } = await supabaseAdmin()
    .from('prospecto').select('id')
    .ilike('correo', remitente).is('duplicado_de', null).limit(1);
  if (errPrincipal) return { ok: false, motivo: `prospecto ilegible: ${errPrincipal.message}` };
  prospectoId = (porPrincipal?.[0] as { id: string } | undefined)?.id ?? null;
  if (!prospectoId) {
    const { data: porCopia, error: errCopia } = await supabaseAdmin()
      .from('prospecto_correo').select('prospecto_id')
      .eq('correo', remitente).limit(1);
    if (errCopia) return { ok: false, motivo: `prospecto_correo ilegible: ${errCopia.message}` };
    prospectoId = (porCopia?.[0] as { prospecto_id: string } | undefined)?.prospecto_id ?? null;
  }

  if (!prospectoId) {
    logger.info('campania.respuesta_sin_prospecto', { baja });
    return { ok: true, resultado: baja ? 'baja_sin_prospecto' : 'respuesta_sin_prospecto' };
  }

  // La respuesta al historial (0118): es lo que detiene la cadencia del SDR.
  const { error: errContacto } = await supabaseAdmin().from('prospecto_contacto').insert({
    prospecto_id: prospectoId, canal: 'correo', direccion: 'respuesta',
    resumen: `Contestó${baja ? ' pidiendo BAJA' : ''}: «${asunto || 'sin asunto'}»`.slice(0, 300),
    actor_id: null,
  });
  if (errContacto) return { ok: false, motivo: `historial no escrito: ${errContacto.message}` };

  // El humano toma la conversación — la máquina jamás contesta.
  await alertarOperador('campania.respuesta', {
    error: baja
      ? 'Un prospecto contestó pidiendo BAJA — quedó suprimido; nada que hacer salvo tomar nota.'
      : `Un prospecto CONTESTÓ un correo de campaña («${asunto || 'sin asunto'}») — la cadencia se detuvo; la conversación es tuya.`,
    codigo: baja ? 'campania_baja' : 'campania_respuesta',
  });
  logger.info('campania.respuesta', { prospecto: prospectoId, baja });
  return { ok: true, resultado: baja ? 'baja_registrada' : 'respuesta_registrada' };
}
