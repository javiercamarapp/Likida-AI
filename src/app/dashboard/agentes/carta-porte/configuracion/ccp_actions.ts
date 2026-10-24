'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { confirmarYResponder } from '@/lib/likida/carta_porte_docs/ccp_respuesta';
import { depsCcp, fijarRespuestaActiva, leerPorId } from '@/lib/likida/carta_porte_docs/ccp_respuesta_repo';
import type { ResultadoAccion } from '@/app/dashboard/carta-porte/documentos/forma_accion';

// A37-A3-01 · RESPONDER AL CLIENTE CON EL CCP TIMBRADO. Server actions a nivel de módulo: sesión, rol y flota se resuelven de
// la cookie; JAMÁS se acepta un tenant_id del formulario. Ruta del área `administracion` (dueño/administrador): mandar un correo
// con un CCP fiscal a un tercero es una decisión de la flota. Fail-closed: sin confirmación humana no sale nada la primera vez.

const RUTA = '/dashboard/agentes/carta-porte/configuracion';
const SIN_PERMISO = 'Tu rol no puede administrar la respuesta con el CCP timbrado.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const verComo = (fd: FormData) => ({
  tenant: typeof fd.get('tenant') === 'string' ? String(fd.get('tenant')) : undefined,
  rol: typeof fd.get('rol') === 'string' ? String(fd.get('rol')) : undefined,
  vista: typeof fd.get('vista') === 'string' ? String(fd.get('vista')) : undefined,
});

const FRASE_MOTIVO = {
  no_encontrada: 'Ese CCP no está en tu flota. Recarga la pantalla.',
  ya_respondida: 'Ya se le respondió al cliente con este CCP.',
  no_aplica: 'Este CCP solo se guardó porque la respuesta al cliente estaba apagada. Enciéndela para poder responder.',
  sin_destino: 'No hay a qué correo responder: escribe el correo del cliente.',
  destino_invalido: 'El correo del cliente no es válido.',
} as const;

/** Enciende o apaga la respuesta al cliente (`responder_ccp`). Por omisión está APAGADA. */
export async function fijarRespuestaCcp(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await resolverTenantEfectivo(RUTA, verComo(fd));
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: SIN_PERMISO };
  try {
    if (!(await rateLimit(`cp-ccp-activo:${s.tenantId}`, 20, 60_000))) return { ok: false, error: 'Demasiados cambios en poco tiempo. Espera un minuto.' };
    const activo = String(fd.get('activo') ?? '') === 'si';
    const r = await fijarRespuestaActiva(s.tenantId, activo, s.userId);
    if (r === 'sin_migracion') return { ok: false, error: 'Esta función todavía no está disponible en tu entorno.' };
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.respuesta_activa', entidad: 'tenant', entidadId: s.tenantId, detalle: { activo } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    revalidatePath(RUTA);
    return { ok: true, mensaje: activo ? 'Encendida: el CCP timbrado se responde al cliente (la primera vez por cliente, tras tu confirmación).' : 'Apagada: el CCP timbrado solo se guarda, no se responde a nadie.' };
  } catch (e) {
    logger.error('carta_porte_docs.ccp_activo_pantalla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'cambiar la respuesta con el CCP') };
  }
}

/** Confirma (y, si hace falta, corrige el destino de) un CCP recibido y responde al cliente. */
export async function confirmarRespuestaCcp(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await resolverTenantEfectivo(RUTA, verComo(fd));
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: SIN_PERMISO };
  try {
    if (!(await rateLimit(`cp-ccp-confirmar:${s.tenantId}`, 30, 60_000))) return { ok: false, error: 'Demasiadas confirmaciones en poco tiempo. Espera un minuto.' };
    const id = String(fd.get('ccpId') ?? '');
    if (!UUID.test(id)) return { ok: false, error: 'Falta el CCP. Recarga la pantalla.' };
    const crudo = String(fd.get('destino') ?? '').trim();
    const fila = await leerPorId(s.tenantId, id);
    const r = await confirmarYResponder(depsCcp(), s.tenantId, fila, crudo === '' ? undefined : crudo);
    if (!r.ok) return { ok: false, error: FRASE_MOTIVO[r.motivo] };
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.respuesta_confirmada', entidad: 'tenant', entidadId: s.tenantId, detalle: { ccpId: id, respondido: r.respondido, estado: r.estado } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    revalidatePath(RUTA);
    return r.respondido
      ? { ok: true, mensaje: 'Listo: se le mandó al cliente el CCP timbrado (PDF y XML).' }
      : { ok: false, error: 'El correo no salió (queda como «error de envío» para reintentar). Revisa el correo del cliente.' };
  } catch (e) {
    logger.error('carta_porte_docs.ccp_confirmar_pantalla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'responder al cliente') };
  }
}
