import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { datoInvalido } from '@/lib/likida/errores';
import { esUuidValido } from '@/lib/likida/intake/cfdi';
import { logger } from '@/lib/logger';
import { anotarAccionAdmin, type ActorAdmin } from '@/lib/admin/acciones_riesgo';
import { BAN_PERMANENTE } from './usuarios_escritura';

// ═══════════════════════════════════════════════════════════════════════════
// BAJA Y REACTIVACIÓN DEL PERSONAL DE LIKIDA (superadmin y vendedor) — SUB-ENTREGA 4b, MARCADA PARA REVISIÓN DEL DUEÑO.
//
// El hueco (FUNC-CUENTAS, P0): `usuarios_escritura.leerObjetivo` filtra por flota y rechaza al superadmin A PROPÓSITO, así que no existía
// forma de dar de baja a un vendedor que se va ni de revocar a un superadmin comprometido sin SQL y sin tocar Auth a mano. Esta función es
// NUEVA (no se tocó `leerObjetivo`): opera solo sobre filas SIN flota (`tenant_id` nulo) con rol `superadmin` o `vendedor`.
//
// ── LOS CANDADOS (no negociables) ────────────────────────────────────────
//  1. NUNCA A UNO MISMO. Quien da la baja no puede ser la cuenta dada de baja.
//  2. NUNCA EL ÚLTIMO SUPERADMIN ACTIVO. Revocar al único superadmin deja a Likida sin operador.
//  3. SOLO PERSONAL DE LIKIDA. Una cuenta con flota o con otro rol se rechaza con el camino correcto (Equipo > gestión de personas).
//  4. Segundo factor reciente (step-up) y bitácora `usuario.desactivado` / `usuario.reactivado`: los pone la acción de servidor y esta función.
//
// ── ATOMICIDAD ───────────────────────────────────────────────────────────
// El candado 2 es «cuenta y luego escribe»: sin ayuda de la base, dos superadmin que se den de baja a la vez entre sí pasarían los dos.
// La migración 1000 (`equipo_baja_personal_likida`) lo cierra con un candado de transacción; mientras no esté aplicada, esta función
// cae a un camino de aplicación que cuenta antes y RECUENTA después: si tras escribir no queda ningún superadmin activo, REVIERTE su
// propia baja y lo dice. El camino de aplicación puede dejar una ventana de milisegundos entre la escritura y la reversión: por eso
// la migración está propuesta, y por eso la función entera nace APAGADA (`LIKIDA_BAJA_PERSONAL_LIKIDA=activo` la enciende).
// ═══════════════════════════════════════════════════════════════════════════

/** La función nace apagada hasta que el dueño la revise. Solo el valor exacto `activo` la enciende. */
export function bajaPersonalLikidaHabilitada(): boolean {
  return process.env.LIKIDA_BAJA_PERSONAL_LIKIDA === 'activo';
}

export const ROLES_PERSONAL_LIKIDA = ['superadmin', 'vendedor'] as const;
export type RolPersonalLikida = (typeof ROLES_PERSONAL_LIKIDA)[number];

interface FilaPersonal { id: string; rol: string; activo: boolean; tenant_id: string | null }

export interface ResultadoBajaLikida {
  rol: RolPersonalLikida;
  /** `true` si Auth aceptó el ban (el refresco de su sesión muere). `false` = la fila quedó de baja pero el ban no entró: reintentar. */
  sesionRevocada: boolean;
  /** `false` = la baja se hizo pero la bitácora no pudo escribir; quien llama lo dice en pantalla. */
  bitacora: boolean;
  /** `rpc` = la migración 1000 está aplicada y el candado lo puso la base; `aplicacion` = camino de respaldo. */
  candado: 'rpc' | 'aplicacion';
}

function exigirUuid(id: string): void {
  if (!esUuidValido(id)) throw datoInvalido('usuarios_escri.no_se_reconoce_esa_cuenta');
}

async function leerPersonal(usuarioId: string): Promise<FilaPersonal & { rol: RolPersonalLikida }> {
  const { data, error } = await acotada(supabaseAdmin().from('app_user')
    .select('id, rol, activo, tenant_id').eq('id', usuarioId).maybeSingle(), 'baja_acceso.leer');
  if (error) throw new Error(`baja_acceso.leer: ${error.message}`);
  if (!data) throw datoInvalido('baja_acceso.no_se_reconoce_esa_cuenta');
  const esLikida = !data.tenant_id && (ROLES_PERSONAL_LIKIDA as readonly string[]).includes(String(data.rol));
  if (!esLikida) {
    throw datoInvalido('baja_acceso.esa_cuenta_es_de_una');
  }
  return { id: String(data.id), rol: data.rol as RolPersonalLikida, activo: data.activo !== false, tenant_id: null };
}

async function superadminsActivos(excluyendo?: string): Promise<number> {
  let q = supabaseAdmin().from('app_user').select('id').eq('rol', 'superadmin').eq('activo', true);
  if (excluyendo) q = q.neq('id', excluyendo);
  // orden-no-importa: solo se cuenta si hay uno o dos superadmins activos, no cuáles; cualquier par de filas da la misma respuesta.
  const { data, error } = await acotada(q.limit(2), 'baja_acceso.contar_superadmins');
  // Falla CERRADA: si no se puede contar, no se afirma que "hay otro".
  if (error) throw new Error(`baja_acceso.contar_superadmins: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}


/** ¿La RPC de la migración 1000 todavía no existe en esta base? (PostgREST: PGRST202 / "Could not find the function"; Postgres: 42883). */
function rpcNoExiste(error: { code?: string; message?: string }): boolean {
  const m = (error.message ?? '').toLowerCase();
  return error.code === 'PGRST202' || error.code === '42883' || m.includes('could not find the function') || m.includes('does not exist');
}

export async function darDeBajaPersonalLikida(usuarioId: string, actor: ActorAdmin): Promise<ResultadoBajaLikida> {
  if (!bajaPersonalLikidaHabilitada()) throw datoInvalido('baja_acceso.apagada');
  exigirUuid(usuarioId);
  if (usuarioId === actor.userId) throw datoInvalido('baja_acceso.uno_mismo');
  const objetivo = await leerPersonal(usuarioId);
  if (!objetivo.activo) throw datoInvalido('usuarios_escri.esa_cuenta_ya_esta_dada');

  let candado: 'rpc' | 'aplicacion' = 'rpc';
  const { data: veredicto, error } = await acotada(
    supabaseAdmin().rpc('equipo_baja_personal_likida', { p_usuario: usuarioId, p_actor: actor.userId }), 'baja_acceso.rpc');
  if (error && rpcNoExiste(error)) {
    candado = 'aplicacion';
    await bajaDesdeAplicacion(objetivo, usuarioId, actor.userId);
  } else if (error) {
    throw new Error(`baja_acceso.rpc: ${error.message}`);
  } else if (veredicto === 'ultimo_superadmin') {
    throw datoInvalido('baja_acceso.ultimo');
  } else if (veredicto === 'uno_mismo') {
    throw datoInvalido('baja_acceso.uno_mismo');
  } else if (veredicto !== 'ok') {
    throw datoInvalido('baja_acceso.conflicto');
  }

  // La revocación REAL (misma que `desactivarUsuario`): sin el ban, la cookie sigue refrescándose. Best-effort DESPUÉS de la fila: si
  // falla, se DICE; no se revierte la baja por ello.
  let sesionRevocada = true;
  try {
    const { error: errBan } = await supabaseAdmin().auth.admin.updateUserById(usuarioId, { ban_duration: BAN_PERMANENTE });
    if (errBan) { sesionRevocada = false; logger.error('baja_likida.ban_fallo', { usuario: usuarioId, err: errBan.message }); }
    const { error: errSes } = await supabaseAdmin().rpc('revocar_sesiones_usuario', { p_usuario: usuarioId });
    if (errSes) { sesionRevocada = false; logger.error('baja_likida.sesiones_fallo', { usuario: usuarioId, err: errSes.message }); }
  } catch (e) {
    sesionRevocada = false;
    logger.error('baja_likida.revocar_fallo', { usuario: usuarioId, err: e instanceof Error ? e.message : String(e) });
  }

  const bitacora = await anotarAccionAdmin({
    actor, tenantId: null, accion: 'usuario.desactivado', entidad: 'app_user', entidadId: usuarioId,
    detalle: { rol: objetivo.rol, ambito: 'likida', sesion_revocada: sesionRevocada, candado },
  });
  return { rol: objetivo.rol, sesionRevocada, bitacora, candado };
}

/** Camino de respaldo (sin la migración 1000): cuenta, escribe condicionado, RECUENTA y revierte si dejó a Likida sin superadmin. */
async function bajaDesdeAplicacion(objetivo: { rol: RolPersonalLikida }, usuarioId: string, actorId: string): Promise<void> {
  if (objetivo.rol === 'superadmin' && (await superadminsActivos(usuarioId)) === 0) throw datoInvalido('baja_acceso.ultimo');

  const { data, error } = await acotada(supabaseAdmin().from('app_user')
    .update({ activo: false, desactivado_en: new Date().toISOString(), desactivado_por: actorId })
    .eq('id', usuarioId).is('tenant_id', null).eq('activo', true).select('id'), 'baja_acceso.escribir');
  if (error) throw new Error(`baja_acceso.escribir: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) throw datoInvalido('baja_acceso.conflicto');

  if (objetivo.rol === 'superadmin') {
    let quedan = 0;
    try { quedan = await superadminsActivos(); } catch (e) {
      logger.error('baja_likida.recuento_fallo', { usuario: usuarioId, err: e instanceof Error ? e.message : String(e) });
    }
    if (quedan === 0) {
      // Compensación: dos bajas simultáneas entre superadmin. Se devuelve la cuenta y se dice.
      const { error: errRev } = await supabaseAdmin().from('app_user')
        .update({ activo: true, desactivado_en: null, desactivado_por: null }).eq('id', usuarioId).is('tenant_id', null);
      if (errRev) logger.error('baja_likida.reversion_fallo', { usuario: usuarioId, err: errRev.message });
      throw datoInvalido('baja_acceso.ultimo');
    }
  }
}

export interface ResultadoReactivacionLikida {
  rol: RolPersonalLikida;
  accesoRestaurado: boolean;
  bitacora: boolean;
}

export async function reactivarPersonalLikida(usuarioId: string, actor: ActorAdmin): Promise<ResultadoReactivacionLikida> {
  if (!bajaPersonalLikidaHabilitada()) throw datoInvalido('baja_acceso.apagada');
  exigirUuid(usuarioId);
  const objetivo = await leerPersonal(usuarioId);
  if (objetivo.activo) throw datoInvalido('usuarios_escri.esa_cuenta_ya_esta_activa');

  const { data, error } = await acotada(supabaseAdmin().from('app_user')
    .update({ activo: true, desactivado_en: null, desactivado_por: null })
    .eq('id', usuarioId).is('tenant_id', null).eq('activo', false).select('id'), 'baja_acceso.reactivar');
  if (error) throw new Error(`baja_acceso.reactivar: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) throw datoInvalido('usuarios_escri.esa_cuenta_ya_estaba_activa');

  let accesoRestaurado = true;
  try {
    const { error: errBan } = await supabaseAdmin().auth.admin.updateUserById(usuarioId, { ban_duration: 'none' });
    if (errBan) { accesoRestaurado = false; logger.error('baja_likida.desban_fallo', { usuario: usuarioId, err: errBan.message }); }
  } catch (e) {
    accesoRestaurado = false;
    logger.error('baja_likida.desban_fallo', { usuario: usuarioId, err: e instanceof Error ? e.message : String(e) });
  }
  const bitacora = await anotarAccionAdmin({
    actor, tenantId: null, accion: 'usuario.reactivado', entidad: 'app_user', entidadId: usuarioId,
    detalle: { rol: objetivo.rol, ambito: 'likida', acceso_restaurado: accesoRestaurado },
  });
  return { rol: objetivo.rol, accesoRestaurado, bitacora };
}
