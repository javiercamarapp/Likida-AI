// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LA PANTALLA DE «DESCARGA DEL SAT» ESCRIBE (0231).
//
// Tres actos, y NINGUNO toca una credencial:
//   · declarar el RFC del buzón y la anticipación del aviso de peaje;
//   · verificar contra el proveedor que la e.firma sigue cargada EN SU BÓVEDA
//     (se guarda la referencia y la vigencia; jamás la llave);
//   · pedir un rango a mano, cuando el contralor quiere un periodo viejo que
//     el cron no va a alcanzar solo.
//
// Todo pasa por `bitacora` porque son actos sobre el circuito fiscal de una
// flota: quién declaró qué RFC y quién pidió qué periodo es exactamente lo
// que alguien va a querer reconstruir dentro de seis meses.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { DatoInvalido } from '../errores';
import { resolverDescargaSat, estadoDescargaSat } from './index';
import { VENTANA_MAX_DIAS } from './ciclo';

const RFC = /^[A-ZÑ&0-9]{12,13}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export interface Actor { id?: string; email?: string }

/** Declara el RFC del buzón y la anticipación del aviso de peaje. */
export async function guardarConfigDescarga(
  tenantId: string,
  datos: { rfc: string; modo: string; peajeDiasAviso: number; activa: boolean },
  actor: Actor = {},
): Promise<void> {
  const rfc = datos.rfc.trim().toUpperCase();
  if (!RFC.test(rfc)) {
    throw new DatoInvalido('El RFC no tiene forma de RFC (12 o 13 caracteres). Cópialo de tu constancia de situación fiscal.');
  }
  if (datos.modo !== 'webservice' && datos.modo !== 'portal') {
    throw new DatoInvalido('El modo tiene que ser «webservice» o «portal».');
  }
  if (!Number.isInteger(datos.peajeDiasAviso) || datos.peajeDiasAviso < 1 || datos.peajeDiasAviso > 25) {
    throw new DatoInvalido('La anticipación del aviso de peaje va de 1 a 25 días: el derecho se vence el último día del mes, así que avisar con 26 sería avisar el día 5.');
  }
  const { error } = await acotada(supabaseAdmin()
    .from('sat_descarga_config')
    .upsert({
      tenant_id: tenantId,
      rfc,
      modo: datos.modo,
      peaje_dias_aviso: datos.peajeDiasAviso,
      activa: datos.activa,
      actualizado_en: new Date().toISOString(),
      actualizado_por: actor.id ?? null,
    }, { onConflict: 'tenant_id' }), 'sat_descarga.guardar_config');
  if (error) throw new Error(error.message);
  await anotarBitacora({
    tenantId, actor, accion: 'sat_descarga.config',
    entidad: 'sat_descarga_config', entidadId: tenantId,
    detalle: { rfc, modo: datos.modo, activa: datos.activa, peajeDiasAviso: datos.peajeDiasAviso },
  });
}

export interface ResultadoVerificacionCredencial {
  ok: boolean;
  mensaje: string;
}

/**
 * Pregunta al proveedor si la e.firma sigue en su bóveda y guarda la
 * REFERENCIA. Likida no recibe la credencial ni en esta llamada ni en ninguna:
 * lo que vuelve es un número de serie y una fecha de vigencia.
 */
export async function verificarCredencial(
  tenantId: string,
  actor: Actor = {},
): Promise<ResultadoVerificacionCredencial> {
  const prov = resolverDescargaSat();
  if (prov === null) {
    return { ok: false, mensaje: estadoDescargaSat().motivo ?? 'La descarga masiva no está configurada.' };
  }
  const { data, error } = await acotada(supabaseAdmin()
    .from('sat_descarga_config')
    .select('rfc')
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'sat_descarga.rfc_para_verificar');
  if (error) throw new Error(error.message);
  if (data === null) {
    return { ok: false, mensaje: 'Todavía no has declarado el RFC del buzón que se va a descargar.' };
  }

  const r = await prov.credencial(data.rfc as string);
  if (!r.ok) {
    // El mensaje del proveedor TAL CUAL, y se guarda para que la pantalla lo
    // enseñe sin volver a llamar.
    await acotada(supabaseAdmin().from('sat_descarga_config')
      .update({ verificada_en: new Date().toISOString(), certificado_numero: null, certificado_vence_en: null })
      .eq('tenant_id', tenantId), 'sat_descarga.credencial_no');
    return { ok: false, mensaje: r.mensaje };
  }
  const { error: errUpd } = await acotada(supabaseAdmin()
    .from('sat_descarga_config')
    .update({
      certificado_numero: r.numero,
      certificado_vence_en: r.venceEn,
      verificada_en: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId), 'sat_descarga.credencial_si');
  if (errUpd) logger.warn('sat_descarga.credencial_no_guardada', { tenantId, err: errUpd.message });
  // El detalle guarda la REFERENCIA y la vigencia. Nunca la credencial: no
  // la tenemos, y si la tuviéramos tampoco iría a una bitácora.
  await anotarBitacora({
    tenantId, actor, accion: 'sat_descarga.credencial_verificada',
    entidad: 'sat_descarga_config', entidadId: tenantId,
    detalle: { certificado: r.numero, venceEn: r.venceEn },
  });
  return {
    ok: true,
    mensaje: `e.firma cargada en la bóveda del proveedor${r.venceEn ? ` — vence el ${r.venceEn}` : ''}. Likida no la guarda: solo su número de referencia.`,
  };
}

/**
 * Pide un rango a mano. Es el botón para el periodo viejo que el cron no va a
 * alcanzar solo, no un atajo para saltarse la cola: si ese rango ya tiene un
 * trámite vivo, la base lo rebota y aquí se dice.
 */
export async function pedirRangoManual(
  tenantId: string,
  datos: { desde: string; hasta: string; tipo: 'recibidos' | 'emitidos' },
  actor: Actor = {},
): Promise<{ ok: boolean; mensaje: string }> {
  if (!FECHA.test(datos.desde) || !FECHA.test(datos.hasta)) {
    throw new DatoInvalido('Las fechas van en formato AAAA-MM-DD.');
  }
  if (datos.hasta < datos.desde) {
    throw new DatoInvalido('La fecha final no puede ser anterior a la inicial.');
  }
  const dias = Math.round(
    (Date.parse(`${datos.hasta}T00:00:00Z`) - Date.parse(`${datos.desde}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (dias > VENTANA_MAX_DIAS) {
    throw new DatoInvalido(`El rango máximo por solicitud es de ${VENTANA_MAX_DIAS} días y pediste ${dias}. Es un tope nuestro, no del SAT: repartir el año en pedazos evita que un fallo se lleve el rango entero. Pide este mes y luego el anterior.`);
  }

  const prov = resolverDescargaSat();
  if (prov === null) {
    return { ok: false, mensaje: estadoDescargaSat().motivo ?? 'La descarga masiva no está configurada.' };
  }
  const { data: cfg, error } = await acotada(supabaseAdmin()
    .from('sat_descarga_config')
    .select('rfc, activa')
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'sat_descarga.rfc_para_pedir');
  if (error) throw new Error(error.message);
  if (cfg === null) return { ok: false, mensaje: 'Todavía no has declarado el RFC del buzón que se va a descargar.' };
  if (!cfg.activa) return { ok: false, mensaje: 'La descarga está pausada para esta flota. Actívala antes de pedir un rango.' };

  // Reserva-antes-de-llamar (patrón 0227): la fila existe antes de tocar la
  // red, así que un timeout ambiguo no deja el rango pidiéndose dos veces.
  const { data: fila, error: errIns } = await acotada(supabaseAdmin()
    .from('sat_descarga_solicitud')
    .insert({
      tenant_id: tenantId, proveedor: prov.nombre, tipo: datos.tipo,
      desde: datos.desde, hasta: datos.hasta, estado: 'solicitada', intentos: 1,
    })
    .select('id')
    .single(), 'sat_descarga.reservar_manual');
  if (errIns || fila === null) {
    return {
      ok: false,
      mensaje: 'Ese rango ya tiene una solicitud en curso ante el SAT. Espera a que termine (puede tardar hasta 6 días) antes de volver a pedirlo — reintentarlo consume el tope diario del RFC.',
    };
  }

  const r = await prov.solicitar({ rfc: cfg.rfc as string, ...datos });
  if (!r.ok) {
    await acotada(supabaseAdmin().from('sat_descarga_solicitud')
      .update({ proveedor_mensaje: r.mensaje, ...(r.clase === 'red' ? {} : { estado: 'error' }) })
      .eq('tenant_id', tenantId).eq('id', fila.id), 'sat_descarga.manual_err');
    return { ok: false, mensaje: r.mensaje };
  }
  await acotada(supabaseAdmin().from('sat_descarga_solicitud')
    .update({ request_id: r.requestId, estado: 'en_proceso' })
    .eq('tenant_id', tenantId).eq('id', fila.id), 'sat_descarga.manual_ok');
  await anotarBitacora({
    tenantId, actor, accion: 'sat_descarga.solicitud_manual',
    entidad: 'sat_descarga_solicitud', entidadId: fila.id as string,
    detalle: { tipo: datos.tipo, desde: datos.desde, hasta: datos.hasta, requestId: r.requestId },
  });
  return {
    ok: true,
    mensaje: `Solicitud abierta ante el SAT (${r.requestId}). El SAT tarda: hasta 6 días por web service. Likida la revisa sola cada 6 horas y aquí se ve cuando lleguen los comprobantes.`,
  };
}
