'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantAtadoFirmado, CAMPO_FLOTA_PINTADA, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { confirmarYResponder } from '@/lib/likida/carta_porte_docs/ccp_respuesta';
import { depsCcp, fijarRespuestaActiva, leerPorId } from '@/lib/likida/carta_porte_docs/ccp_respuesta_repo';
import type { ResultadoAccion } from '@/app/dashboard/carta-porte/documentos/forma_accion';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// A37-A3-01 · RESPONDER AL CLIENTE CON EL CCP TIMBRADO. Server actions a nivel de módulo: sesión, rol y flota se resuelven de
// la cookie; JAMÁS se acepta un tenant_id del formulario. Ruta del área `administracion` (dueño/administrador): mandar un correo
// con un CCP fiscal a un tercero es una decisión de la flota. Fail-closed: sin confirmación humana no sale nada la primera vez.

const RUTA = '/dashboard/agentes/carta-porte/configuracion';
const sinPermiso = (tx: TAgentes = TR_ES.t) => (tx('rest.tu_rol_no_puede_administrar_la'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fraseMotivo = (tx: TAgentes = TR_ES.t) => ({
  no_encontrada: tx('rest.ese_ccp_no_esta_en_tu'),
  ya_respondida: tx('rest.ya_se_le_respondio_al_cliente'),
  no_aplica: tx('rest.este_ccp_solo_se_guardo_porque'),
  sin_destino: tx('rest.no_hay_a_que_correo_responder'),
  destino_invalido: tx('rest.el_correo_del_cliente_no_es'),
} as const);

/** Enciende o apaga la respuesta al cliente (`responder_ccp`). Por omisión está APAGADA. */
export async function fijarRespuestaCcp(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: sinPermiso(tx) };
  try {
    if (!(await rateLimit(`cp-ccp-activo:${s.tenantId}`, 20, 60_000))) return { ok: false, error: tx('rest.demasiados_cambios_en_poco_tiempo_espera') };
    const activo = String(fd.get('activo') ?? '') === 'si';
    const r = await fijarRespuestaActiva(s.tenantId, activo, s.userId);
    if (r === 'sin_migracion') return { ok: false, error: tx('rest.esta_funcion_todavia_no_esta_disponible') };
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.respuesta_activa', entidad: 'tenant', entidadId: s.tenantId, detalle: { activo } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    revalidatePath(RUTA);
    return { ok: true, mensaje: activo ? tx('rest.encendida_el_ccp_timbrado_se_responde') : tx('rest.apagada_el_ccp_timbrado_solo_se') };
  } catch (e) {
    logger.error('carta_porte_docs.ccp_activo_pantalla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, tx('rest.cambiar_la_respuesta_con_el_ccp')) };
  }
}

/** Confirma (y, si hace falta, corrige el destino de) un CCP recibido y responde al cliente. */
export async function confirmarRespuestaCcp(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: sinPermiso(tx) };
  try {
    if (!(await rateLimit(`cp-ccp-confirmar:${s.tenantId}`, 30, 60_000))) return { ok: false, error: tx('rest.demasiadas_confirmaciones_en_poco_tiempo_espera') };
    const id = String(fd.get('ccpId') ?? '');
    if (!UUID.test(id)) return { ok: false, error: tx('rest.falta_el_ccp_recarga_la_pantalla') };
    const crudo = String(fd.get('destino') ?? '').trim();
    const fila = await leerPorId(s.tenantId, id);
    const r = await confirmarYResponder(depsCcp(), s.tenantId, fila, crudo === '' ? undefined : crudo);
    if (!r.ok) return { ok: false, error: fraseMotivo(tx)[r.motivo] };
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.respuesta_confirmada', entidad: 'tenant', entidadId: s.tenantId, detalle: { ccpId: id, respondido: r.respondido, estado: r.estado } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    revalidatePath(RUTA);
    return r.respondido
      ? { ok: true, mensaje: tx('rest.listo_se_le_mando_al_cliente') }
      : { ok: false, error: tx('rest.el_correo_no_salio_queda_como') };
  } catch (e) {
    logger.error('carta_porte_docs.ccp_confirmar_pantalla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'responder al cliente') };
  }
}
