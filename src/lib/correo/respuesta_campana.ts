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
//   2. Si matchea un prospecto, BORRA de inmediato los datos de esa persona
//      (AUDITORÍA 25, ALTO — ver `borrarDatosPersonaPorBaja`): el aviso
//      promete "se borran tus datos de persona" y, hasta esta migración de
//      código, no se borraba nada.
//   3. Registra `direccion:'respuesta'` en el historial del prospecto (0118)
//      — eso detiene la cadencia del SDR, que ya la miraba. Esta fila SÍ
//      cuenta como "toque reciente" para el filtro de frialdad de
//      `purgar_prospecto_persona` (0258), pero para ENTONCES la persona que
//      pidió la baja ya no tiene datos que purgar — el paso 2 la adelantó.
//   4. Avisa al operador: el cierre es humano; la máquina jamás contesta una
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

/**
 * AUDITORÍA 25 (ALTO): el borrado real de una BAJA. Antes de esto, un BAJA
 * solo suprimía el correo (no volver a escribirle) y registraba un
 * `prospecto_contacto` que además REINICIABA el reloj de 365 días de
 * `purgar_prospecto_persona` (0258) — ejercer el derecho alargaba la
 * retención en vez de acortarla.
 *
 * Borra de inmediato lo que `avisoProspectos` (`privacidad.ts`, sección "Qué
 * datos tenemos") enumera como datos de la persona — nombre, puesto, correo,
 * teléfono, perfil —, y SOLO de la persona que pidió la baja: no toca a otros
 * contactos de la misma empresa que no la pidieron, ni la ficha de EMPRESA
 * (nombre, giro, plaza), que no es un dato suyo. Mismo criterio de columnas
 * que `purgar_prospecto_persona`.
 *
 * Respeta `conservar_hasta` (0148): un freno humano vigente (p. ej. un ARCO
 * de acceso en curso) no se pisa por una BAJA concurrente — se registra y
 * queda para revisión, en vez de borrar de más.
 *
 * Mejor esfuerzo por tabla: el fallo de una no debe impedir el resto: cada
 * una se registra si truena, y nunca lanza hacia el webhook que la llama
 * (mismo contrato que `suprimirCorreo`).
 */
export async function borrarDatosPersonaPorBaja(prospectoId: string, correo: string, esContactoPrincipal: boolean): Promise<void> {
  const db = supabaseAdmin();
  const ahoraIso = new Date().toISOString();

  const { error: errPersona } = await db.from('prospecto_persona')
    .delete()
    .eq('prospecto_id', prospectoId)
    .ilike('correo', correo)
    .or(`conservar_hasta.is.null,conservar_hasta.lt.${ahoraIso}`);
  if (errPersona) logger.error('campania.baja_persona_no_borrada', { prospecto: prospectoId, err: errPersona.message });

  const { error: errCopia } = await db.from('prospecto_correo')
    .delete()
    .eq('prospecto_id', prospectoId)
    .ilike('correo', correo);
  if (errCopia) logger.error('campania.baja_correo_no_borrado', { prospecto: prospectoId, err: errCopia.message });

  // Solo si ESTE correo era el contacto de cabecera del prospecto: si el
  // remitente era una copia (`prospecto_correo`), el nombre/correo/teléfono
  // de cabecera son de OTRA persona y no se tocan.
  if (esContactoPrincipal) {
    const { error: errPrincipal } = await db.from('prospecto')
      .update({
        contacto_nombre: null, telefono: null, correo: null, notas: null,
        lead_clave: null, mensaje_wa: null, mensaje_correo_asunto: null,
        mensaje_correo: null, mensajes_generados_en: null, mensajes_modelo: null,
        atribucion: null, updated_at: ahoraIso,
      })
      .eq('id', prospectoId);
    if (errPrincipal) logger.error('campania.baja_prospecto_no_anonimizado', { prospecto: prospectoId, err: errPrincipal.message });
  }
}

export interface ProspectoPorCorreo {
  prospectoId: string | null;
  /** ¿El correo es el contacto de cabecera del prospecto (`prospecto.correo`),
   *  o solo apareció como copia en `prospecto_correo`? */
  esContactoPrincipal: boolean;
}

/** El mismo prospecto que ve `procesarRespuestaCampana`: por correo
 *  principal, o por cualquiera de las copias que dejó el investigador
 *  (0217). Exportada para que la liga de un clic (`api/correo/baja`) borre
 *  los mismos datos que borraría una respuesta de correo. */
export async function resolverProspectoPorCorreo(correo: string): Promise<ProspectoPorCorreo | { error: string }> {
  const { data: porPrincipal, error: errPrincipal } = await supabaseAdmin()
    .from('prospecto').select('id')
    .ilike('correo', correo).is('duplicado_de', null).limit(1);
  if (errPrincipal) return { error: `prospecto ilegible: ${errPrincipal.message}` };
  const idPrincipal = (porPrincipal?.[0] as { id: string } | undefined)?.id ?? null;
  if (idPrincipal) return { prospectoId: idPrincipal, esContactoPrincipal: true };

  const { data: porCopia, error: errCopia } = await supabaseAdmin()
    .from('prospecto_correo').select('prospecto_id')
    .eq('correo', correo).limit(1);
  if (errCopia) return { error: `prospecto_correo ilegible: ${errCopia.message}` };
  const idCopia = (porCopia?.[0] as { prospecto_id: string } | undefined)?.prospecto_id ?? null;
  return { prospectoId: idCopia, esContactoPrincipal: false };
}

/**
 * La misma baja real de `borrarDatosPersonaPorBaja`, pero para el camino que
 * solo tiene un correo (la liga de un clic, `api/correo/baja/route.ts`) y no
 * pasó ya por `resolverProspectoPorCorreo`. Mejor esfuerzo: nunca lanza — un
 * prospecto no encontrado o un error de lectura no debe romper la
 * confirmación de baja en pantalla, que depende solo de `suprimirCorreo`.
 */
export async function borrarDatosPersonaPorBajaPorCorreo(correo: string): Promise<void> {
  const r = await resolverProspectoPorCorreo(correo);
  if ('error' in r) {
    logger.error('campania.baja_prospecto_no_resuelto', { err: r.error });
    return;
  }
  if (r.prospectoId) await borrarDatosPersonaPorBaja(r.prospectoId, correo, r.esContactoPrincipal);
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
  const resuelto = await resolverProspectoPorCorreo(remitente);
  if ('error' in resuelto) return { ok: false, motivo: resuelto.error };
  const { prospectoId, esContactoPrincipal } = resuelto;

  if (!prospectoId) {
    logger.info('campania.respuesta_sin_prospecto', { baja });
    return { ok: true, resultado: baja ? 'baja_sin_prospecto' : 'respuesta_sin_prospecto' };
  }

  // AUDITORÍA 25 (ALTO): el borrado real, ANTES del historial — la promesa
  // de la baja no depende de que el historial se pueda escribir.
  if (baja) await borrarDatosPersonaPorBaja(prospectoId, remitente, esContactoPrincipal);

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
