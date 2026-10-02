// ═══════════════════════════════════════════════════════════════════════════
// CANCELACIÓN DE UN TIMBRE DE CARTA PORTE (0541) — vía PAC (SW sapien).
//
// Cierra el hallazgo #26 de la auditoría ola 1: `ProveedorPac.cancelar` devolvía
// fijo «aún no está construida» y nada escribía el estado 'cancelado'.
//
// Reglas que este archivo hace cumplir:
//   · UN humano la pide (actor a la fila y a la bitácora); ningún cron cancela.
//   · CLAIM-THEN-ACT, como el timbrado: la fila pasa a cancelacion_estado
//     'solicitada' ANTES de llamar al PAC y esa transición condicionada arbitra la
//     carrera de dos botones. Repetir la petición tras una respuesta ambigua es
//     inocuo (SW contesta 202 «ya cancelado»), por eso 'solicitada' se puede
//     re-pedir pasados `MINUTOS_REINTENTO_SOLICITADA`.
//   · «en proceso» (SW 201) NO libera el viaje: el CFDI sigue vigente y el unique
//     parcial `ccp_timbre_vigente_unico` sigue bloqueando un segundo timbre. La
//     consulta de estatus por API no está verificada contra SW real (ver
//     docs/operacion/agente-autofactura.md), así que quien libera es un HUMANO que
//     vio el acuse/estatus (`confirmarCancelacionTimbre`), con bitácora.
//   · Un 202 (el SAT ya lo tenía cancelado) sí es un hecho del SAT: se confirma solo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { leerContextoTimbre } from './carta_porte_timbre';
import { resolverPac, type MotivoCancelacion, type ProveedorPac } from './pac';

export const MINUTOS_REINTENTO_SOLICITADA = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

export type ResultadoCancelarTimbre =
  | { ok: true; estado: 'en_proceso' | 'confirmada'; mensaje: string }
  | { ok: false; motivo: string };

export interface DepsCancelacion {
  pac?: ProveedorPac | null;
  ahora?: Date;
}

export async function solicitarCancelacionTimbre(
  tenantId: string,
  viajeId: string,
  actor: { id?: string; email?: string },
  p: { motivo: MotivoCancelacion; folioSustitucion?: string | null },
  deps: DepsCancelacion = {},
): Promise<ResultadoCancelarTimbre> {
  const motivo = p.motivo;
  const folio = p.folioSustitucion?.trim().toLowerCase() || null;
  if (!['01', '02', '03', '04'].includes(motivo)) return { ok: false, motivo: 'El motivo debe ser una clave del SAT: 01, 02, 03 o 04.' };
  if (motivo === '01' && (folio === null || !UUID.test(folio))) {
    return { ok: false, motivo: 'El motivo 01 exige el folio fiscal (UUID) del CFDI que sustituye al cancelado.' };
  }
  if (motivo !== '01' && folio !== null) return { ok: false, motivo: 'Solo el motivo 01 lleva folio de sustitución.' };

  const ctx = await leerContextoTimbre(tenantId, viajeId);
  if (ctx === null) return { ok: false, motivo: 'Ese viaje no está en tu flota.' };
  const tv = ctx.timbreVigente;
  if (tv === null) return { ok: false, motivo: 'Este viaje no tiene un timbre vigente que cancelar.' };
  if (tv.cancelacion?.estado === 'en_proceso') {
    return { ok: false, motivo: 'La cancelación ya está en proceso ante el SAT. Cuando veas el acuse o el estatus «Cancelado», confírmala aquí.' };
  }
  const rfc = ctx.emisor.rfc?.trim().toUpperCase() ?? '';
  if (!RFC.test(rfc)) return { ok: false, motivo: 'Falta el RFC del emisor en el perfil fiscal de la flota: sin él no se puede pedir la cancelación.' };

  const pac = deps.pac !== undefined ? deps.pac : resolverPac();
  if (pac === null) {
    return { ok: false, motivo: 'No hay PAC configurado (LIKIDA_PAC_*): cancela en el panel de tu PAC y registra aquí el resultado.' };
  }
  if (deps.pac === undefined && tv.modo === 'produccion' && ctx.pac.pareceSandbox === true) {
    return { ok: false, motivo: 'El timbre es de PRODUCCIÓN pero el PAC configurado es el de pruebas: no cancelaría nada real.' };
  }
  if (deps.pac === undefined && tv.modo === 'sandbox' && ctx.pac.pareceSandbox === false) {
    return { ok: false, motivo: 'El timbre es de PRUEBA pero el PAC configurado es el de PRODUCCIÓN: no se cruza el ambiente.' };
  }

  const ahora = deps.ahora ?? new Date();
  const corte = new Date(ahora.getTime() - MINUTOS_REINTENTO_SOLICITADA * 60_000).toISOString();
  const admin = supabaseAdmin();

  // ── EL CLAIM: la transición condicionada arbitra la carrera ───────────────
  const claim = await acotada(admin.from('ccp_timbre').update({
    cancelacion_estado: 'solicitada',
    cancelacion_motivo: motivo,
    cancelacion_folio_sustitucion: folio,
    cancelacion_error: null,
    cancelacion_solicitada_en: ahora.toISOString(),
    cancelacion_solicitada_por: actor.id ?? null,
  })
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'vigente')
    .or(`cancelacion_estado.is.null,cancelacion_estado.eq.rechazada,and(cancelacion_estado.eq.solicitada,cancelacion_solicitada_en.lt.${corte})`)
    .select('id'), 'timbre.cancelar_claim');
  if (claim.error) {
    logger.error('timbre.cancelar_claim_fallo', { viajeId, error: claim.error.message });
    return { ok: false, motivo: 'No se pudo registrar la solicitud de cancelación; no se llamó al PAC. Inténtalo de nuevo.' };
  }
  if (!Array.isArray(claim.data) || claim.data.length === 0) {
    return { ok: false, motivo: 'Otra solicitud de cancelación de este viaje va en curso (o ya se resolvió). Recarga la pantalla.' };
  }

  let r;
  try {
    r = await pac.cancelar({ rfcEmisor: rfc, uuid: tv.uuidFiscal, motivo, ...(folio ? { folioSustitucion: folio } : {}) });
  } catch (e) {
    r = { ok: false as const, clase: 'red' as const, codigo: null, mensaje: `El cliente del PAC lanzó: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!r.ok) {
    // 'red' deja la fila en 'solicitada' (ambiguo: pudo llegar); lo demás es un «no» explícito.
    const patch = r.clase === 'red'
      ? { cancelacion_error: r.mensaje.slice(0, 600) }
      : { cancelacion_estado: 'rechazada', cancelacion_error: r.mensaje.slice(0, 600), cancelacion_codigo: r.codigo };
    const up = await acotada(admin.from('ccp_timbre').update(patch)
      .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'vigente').select('id'), 'timbre.cancelar_resultado');
    if (up.error) logger.error('timbre.cancelar_resultado_sin_guardar', { viajeId, error: up.error.message });
    await anotarBitacora({ tenantId, actor, accion: 'ccp.cancelacion_fallida', entidad: 'viaje', entidadId: viajeId,
      detalle: { motivo, clase: r.clase, codigo: r.codigo } }, { evento: 'timbre.bitacora_no_escribio' });
    return { ok: false, motivo: r.clase === 'red' ? `${r.mensaje}` : `El PAC no canceló: ${r.mensaje}` };
  }

  const yaCancelado = r.estado === 'cancelado';
  const patch = yaCancelado
    ? {
        cancelacion_estado: 'confirmada', cancelacion_codigo: r.codigoSat, cancelacion_acuse: r.acuse,
        cancelacion_confirmada_en: ahora.toISOString(), cancelacion_confirmada_por: actor.id ?? null, estado: 'cancelado',
      }
    : { cancelacion_estado: 'en_proceso', cancelacion_codigo: r.codigoSat, cancelacion_acuse: r.acuse };
  const up = await acotada(admin.from('ccp_timbre').update(patch)
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'vigente').select('id'), 'timbre.cancelar_resultado');
  if (up.error) {
    // El SAT YA recibió la solicitud: se grita con el UUID para que nadie la repita a ciegas.
    logger.error('timbre.cancelar_ok_sin_guardar', { viajeId, uuid: tv.uuidFiscal, codigo: r.codigoSat, error: up.error.message });
  }
  await anotarBitacora({ tenantId, actor, accion: yaCancelado ? 'ccp.cancelacion_confirmada' : 'ccp.cancelacion_en_proceso',
    entidad: 'viaje', entidadId: viajeId, detalle: { motivo, codigo: r.codigoSat, ya_estaba: r.yaEstaba } },
    { evento: 'timbre.bitacora_no_escribio' });

  return yaCancelado
    ? { ok: true, estado: 'confirmada', mensaje: 'El SAT ya tenía este CFDI cancelado. El viaje queda libre para timbrar la corrección.' }
    : { ok: true, estado: 'en_proceso', mensaje: 'El SAT recibió la solicitud de cancelación. Hasta ver el acuse o el estatus «Cancelado» (portal del SAT o panel del PAC), el CFDI se sigue considerando vigente; entonces confírmala aquí para liberar el viaje.' };
}

/** Un humano vio el CFDI cancelado ante el SAT: se libera el viaje para re-timbrar. */
export async function confirmarCancelacionTimbre(
  tenantId: string,
  viajeId: string,
  actor: { id?: string; email?: string },
  verificadoEnSat: boolean,
  ahora: Date = new Date(),
): Promise<ResultadoCancelarTimbre> {
  if (verificadoEnSat !== true) {
    return { ok: false, motivo: 'Confirma que viste el acuse o el estatus «Cancelado» del CFDI en el SAT o en el panel del PAC: dar por cancelado un CFDI vigente permite timbrar un duplicado.' };
  }
  const up = await acotada(supabaseAdmin().from('ccp_timbre').update({
    cancelacion_estado: 'confirmada', cancelacion_confirmada_en: ahora.toISOString(),
    cancelacion_confirmada_por: actor.id ?? null, estado: 'cancelado',
  }).eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'vigente').eq('cancelacion_estado', 'en_proceso').select('id'), 'timbre.cancelar_confirmar');
  if (up.error) throw new Error(`confirmarCancelacionTimbre: ${up.error.message}`);
  if (!Array.isArray(up.data) || up.data.length === 0) {
    return { ok: false, motivo: 'Este timbre no tiene una cancelación «en proceso» que confirmar (ya se confirmó, se rechazó o no se pidió).' };
  }
  await anotarBitacora({ tenantId, actor, accion: 'ccp.cancelacion_confirmada', entidad: 'viaje', entidadId: viajeId,
    detalle: { verificado_en_sat: true } }, { evento: 'timbre.bitacora_no_escribio' });
  return { ok: true, estado: 'confirmada', mensaje: 'Cancelación confirmada. El viaje queda libre para timbrar la corrección.' };
}
