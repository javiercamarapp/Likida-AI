// ═══════════════════════════════════════════════════════════════════════════
// DESTINATARIO DE REVISIÓN — a quién le toca un documento que necesita una persona (T-A3-31).
//
// Regla: un documento que llega a «por revisar» CON bloqueo o duda toma el `destinatario_revision_usuario` de la configuración
// de salida de la flota. Sin esa configuración NADA cambia (el documento queda sin asignar y le toca a «todos los revisores»,
// como hoy). Quién es esa persona NO se codifica: se configura (bloqueo externo B-6).
//
// GUARDIAS
//   · Solo es asignable una persona activa DE ESTA flota con rol de oficina: una de otra flota se rechaza.
//   · Asignar NO sube la `version` del documento (no es un cambio de contenido) y deja el evento `revisor_asignado`
//     con identificadores, jamás con nombres ni correos.
//   · La asignación automática es de MEJOR ESFUERZO: un fallo aquí se loguea y jamás tumba la lectura del documento.
//   · La automática no pisa una asignación hecha por una persona: solo asigna a quien no tiene revisor.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { DatoInvalido } from '../errores';
import { leerConfigSalida } from './salida_config';
import * as repo from './repo';
import type { DocumentoFila } from './repo';
import type { ResultadoValidacion } from './validacion';

export type ResultadoAsignacion =
  | { asignado: true; usuarioId: string }
  | { asignado: false; motivo: 'sin_duda' | 'sin_configuracion' | 'usuario_no_valido' | 'ya_asignado' | 'sin_cambio' | 'error' };

/** ¿Este resultado de validación necesita a una persona? (algún bloqueo, algo por confirmar, o no está listo para aprobar). */
export function necesitaPersona(v: Pick<ResultadoValidacion, 'bloqueos' | 'porConfirmar' | 'listoParaAprobar'> | null): boolean {
  if (!v) return false;
  return v.bloqueos > 0 || v.porConfirmar > 0 || !v.listoParaAprobar;
}

/**
 * Al caer un documento a «por revisar»: si hay bloqueo/duda y la flota configuró un destinatario, se le asigna. Nunca lanza.
 * Idempotente: si ya tiene revisor (el de la configuración u otro puesto a mano) no hace nada y no deja evento.
 */
export async function asignarAlLlegarARevision(
  tenantId: string, documentoId: string, validacion: Pick<ResultadoValidacion, 'bloqueos' | 'porConfirmar' | 'listoParaAprobar'> | null,
): Promise<ResultadoAsignacion> {
  try {
    if (!necesitaPersona(validacion)) return { asignado: false, motivo: 'sin_duda' };
    const config = await leerConfigSalida(tenantId);
    const destino = config.destinatarioRevisionUsuario;
    if (!destino) return { asignado: false, motivo: 'sin_configuracion' };
    const persona = await repo.usuarioRevisor(tenantId, destino);
    if (!persona) {
      logger.warn('carta_porte_docs.revisor_configurado_no_valido', { tenantId, documentoId });
      return { asignado: false, motivo: 'usuario_no_valido' };
    }
    const actual = (await repo.revisoresDeDocumentos(tenantId, [documentoId])).get(documentoId) ?? null;
    if (actual) return { asignado: false, motivo: 'ya_asignado' };
    // Condicional en la base: si una persona asignó entre la lectura y este update, no se pisa (A37-S32-10).
    if (!(await repo.asignarRevisorDoc(tenantId, documentoId, persona.id, true))) {
      const ahora = (await repo.revisoresDeDocumentos(tenantId, [documentoId])).get(documentoId) ?? null;
      return ahora ? { asignado: false, motivo: 'ya_asignado' } : { asignado: false, motivo: 'error' };
    }
    await repo.registrarEvento(tenantId, documentoId, 'revisor_asignado', null, { origen: 'automatica', hacia: persona.id });
    return { asignado: true, usuarioId: persona.id };
  } catch (e) {
    logger.error('carta_porte_docs.asignar_revisor_fallo', { tenantId, documentoId, err: e instanceof Error ? e.message : String(e) });
    return { asignado: false, motivo: 'error' };
  }
}

/**
 * Reasigna (o quita, con `usuarioId = null`) el revisor de un documento desde el visor. Lanza `DatoInvalido` con una frase si
 * el documento o la persona no son de esta flota. Reasignar a quien ya lo tiene no deja evento.
 */
export async function reasignarRevisor(
  tenantId: string, documentoId: string, usuarioId: string | null, actor: { id: string | null },
): Promise<{ cambio: boolean; usuarioId: string | null }> {
  const doc = await repo.leerDocumento(tenantId, documentoId);
  if (!doc) throw new DatoInvalido('Ese documento no está en tu flota, o alguien lo borró. Recarga la pantalla.');
  if (usuarioId !== null && !(await repo.usuarioRevisor(tenantId, usuarioId))) {
    throw new DatoInvalido('Esa persona no está en tu flota o no puede revisar documentos. Elige a alguien de la lista.');
  }
  const actual = (await repo.revisoresDeDocumentos(tenantId, [documentoId])).get(documentoId) ?? null;
  if (actual === usuarioId) return { cambio: false, usuarioId };
  if (!(await repo.asignarRevisorDoc(tenantId, documentoId, usuarioId))) throw new DatoInvalido('Ese documento no está en tu flota, o alguien lo borró. Recarga la pantalla.');
  await repo.registrarEvento(tenantId, documentoId, 'revisor_asignado', actor.id, { origen: 'manual', desde: actual, hacia: usuarioId });
  return { cambio: true, usuarioId };
}

/** «Mis casos»: solo los documentos asignados a esta persona (los sin asignar le tocan a todos y NO se cuentan como suyos). PURA. */
export function soloMisCasos<T extends Pick<DocumentoFila, 'id'>>(filas: ReadonlyArray<T>, asignados: Readonly<Record<string, string>>, usuarioId: string): T[] {
  return filas.filter((d) => asignados[d.id] === usuarioId);
}

/** El teléfono de a quien le toca este documento, para dirigirle el aviso de hallazgos. `null` = sin asignar o sin teléfono (cae al jefe de tráfico). */
export async function telefonoDelRevisor(tenantId: string, documentoId: string): Promise<string | null> {
  const id = (await repo.revisoresDeDocumentos(tenantId, [documentoId])).get(documentoId);
  if (!id) return null;
  return (await repo.usuarioRevisor(tenantId, id))?.telefono ?? null;
}
