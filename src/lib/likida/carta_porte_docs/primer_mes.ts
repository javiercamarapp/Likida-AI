// ═══════════════════════════════════════════════════════════════════════════
// MODO PRIMER MES (OLA1-A3) — durante el primer mes de una flota, cada movimiento de un documento de Carta Porte se copia por
// correo a un revisor por departamento (captura de Carta Porte), para que el cliente vea que el agente hace lo que dice.
//
// Se configura POR FLOTA en `cp_salida_config` (0938): `primer_mes_hasta` (día inclusive; NULL = apagado) y los revisores
// `[{ departamento, correo }]`. Sin la migración, sin fila o fuera de fecha: apagado, sin error.
//
// Qué manda: SOLO el tipo de movimiento, un código corto del documento y la liga al visor (que exige sesión). Nada de campos
// leídos, nombres, RFC ni importes; el asunto es genérico (lo verifica `avisos_correo`). Es de MEJOR ESFUERZO: un fallo aquí
// se registra y jamás tumba la lectura, la aprobación ni el envío del documento.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { DatoInvalido } from '../errores';
import { anotarBitacora } from '../bitacora_escritura';
import { enviarAvisoCorreo, limpiarDestinatarios, type AvisoCorreo, type ResultadoAvisoCorreo } from '../avisos_correo';
import { hoyMx } from '@/lib/formato';
import * as repo from './repo';
import type { PrimerMesFila } from './repo';

export type MovimientoDocumento = 'lectura_lista' | 'aprobado' | 'rechazado' | 'listo_para_subir' | 'subido_a_mano' | 'enviado_al_tms';

const TEXTO: Record<MovimientoDocumento, { asunto: string; titulo: string; cuerpo: string }> = {
  lectura_lista: { asunto: 'Carta Porte: documento leído, por revisar', titulo: 'Un documento ya se leyó', cuerpo: 'El agente terminó de leer el documento y queda por revisar.' },
  aprobado: { asunto: 'Carta Porte: documento aprobado', titulo: 'Un documento se aprobó', cuerpo: 'Una persona aprobó el documento.' },
  rechazado: { asunto: 'Carta Porte: documento rechazado', titulo: 'Un documento se rechazó', cuerpo: 'Una persona rechazó el documento.' },
  listo_para_subir: { asunto: 'Carta Porte: documento listo para subir', titulo: 'La plantilla está lista', cuerpo: 'La plantilla del documento está lista para subirse al sistema del cliente.' },
  subido_a_mano: { asunto: 'Carta Porte: documento subido a mano', titulo: 'Se marcó una subida a mano', cuerpo: 'Una persona marcó el documento como subido a mano al sistema del cliente.' },
  enviado_al_tms: { asunto: 'Carta Porte: documento enviado', titulo: 'Un documento se envió', cuerpo: 'El documento se envió al sistema del cliente.' },
};

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaPrimerMes = z.strictObject({
  hasta: z.string({ error: 'Primer mes: escribe la fecha límite.' }).regex(FECHA, 'Primer mes: usa la fecha AAAA-MM-DD.').nullable(),
  revisores: z.array(z.strictObject({
    departamento: z.string().trim().min(1, 'Revisor: escribe el departamento.').max(60, 'Revisor: el departamento admite hasta 60 caracteres.'),
    correo: z.string().trim().max(254).regex(CORREO, 'Revisor: el correo no es válido.'),
  })).max(20, 'Revisores: máximo 20.'),
}).refine((c) => c.hasta === null || !Number.isNaN(Date.parse(`${c.hasta}T00:00:00Z`)), { message: 'Primer mes: esa fecha no existe.', path: ['hasta'] });

export function validarPrimerMes(c: unknown): PrimerMesFila {
  const r = esquemaPrimerMes.safeParse(c);
  if (r.success) return { hasta: r.data.hasta, revisores: r.data.revisores.map((x) => ({ departamento: x.departamento, correo: x.correo.toLowerCase() })) };
  throw new DatoInvalido(r.error.issues[0].message);
}

/** ¿El modo está encendido HOY (hora de México)? Con la fecha límite inclusive. */
export function primerMesVigente(c: PrimerMesFila | null, ahora: Date): c is PrimerMesFila & { hasta: string } {
  return c !== null && c.hasta !== null && c.revisores.length > 0 && hoyMx(ahora) <= c.hasta;
}

export async function leerPrimerMes(tenantId: string): Promise<PrimerMesFila> {
  return (await repo.leerPrimerMes(tenantId)) ?? { hasta: null, revisores: [] };
}

/** Guarda el modo primer mes. Valida el resultado entero; la bitácora lleva solo los NOMBRES de los campos (jamás correos). */
export async function guardarPrimerMes(tenantId: string, valores: unknown, actor: { id?: string | null; email?: string | null } | 'sistema'): Promise<PrimerMesFila> {
  const nueva = validarPrimerMes(valores);
  const actual = await leerPrimerMes(tenantId);
  const cambiados = [nueva.hasta !== actual.hasta ? 'hasta' : null, JSON.stringify(nueva.revisores) !== JSON.stringify(actual.revisores) ? 'revisores' : null].filter((x): x is string => x !== null);
  if (cambiados.length === 0) return nueva;
  await repo.guardarPrimerMes(tenantId, nueva, actor === 'sistema' ? null : (actor.id ?? null));
  await anotarBitacora(
    { tenantId, actor, accion: 'ccp.primer_mes_guardado', entidad: 'tenant', entidadId: tenantId, detalle: { campos: cambiados, revisores: nueva.revisores.length } },
    { evento: 'carta_porte_docs.bitacora_no_escribio' },
  );
  return nueva;
}

/** Los correos de los revisores del primer mes, o `[]` si el modo no está vigente o no se pudo leer. Nunca lanza. */
export async function revisoresPrimerMes(tenantId: string, ahora: Date = new Date()): Promise<string[]> {
  try {
    const c = await repo.leerPrimerMes(tenantId);
    return primerMesVigente(c, ahora) ? limpiarDestinatarios(c.revisores.map((r) => r.correo)) : [];
  } catch (e) {
    logger.warn('carta_porte_docs.primer_mes_no_leido', { tenantId, err: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    return [];
  }
}

export interface DepsMovimiento {
  revisores?(tenantId: string): Promise<string[]>;
  enviar?(a: AvisoCorreo): Promise<ResultadoAvisoCorreo>;
  urlBandeja?: string;
  ahora?: () => Date;
}

/**
 * Copia un movimiento de un documento a los revisores del primer mes. Mejor esfuerzo: nunca lanza. `version` entra a la llave de
 * idempotencia para que un reintento no mande el mismo movimiento dos veces.
 */
export async function notificarMovimiento(
  tenantId: string, documentoId: string, movimiento: MovimientoDocumento, version: number, deps: DepsMovimiento = {},
): Promise<'enviado' | 'apagado' | 'fallo'> {
  try {
    const para = await (deps.revisores ?? ((t) => revisoresPrimerMes(t, deps.ahora?.())))(tenantId);
    if (para.length === 0) return 'apagado';
    const t = TEXTO[movimiento];
    const codigo = documentoId.replace(/[^0-9a-f]/gi, '').slice(0, 8);
    const r = await (deps.enviar ?? enviarAvisoCorreo)({
      tenantId, agente: 'carta_porte', tipo: `primer_mes_${movimiento}`, asunto: t.asunto, titulo: t.titulo,
      parrafos: [t.cuerpo, 'Recibes esta copia porque la flota está en su primer mes con el agente de Carta Porte.'],
      referencia: codigo, liga: `${deps.urlBandeja ?? `${appUrl()}/dashboard/carta-porte/documentos`}/${documentoId}`, para, clave: `${documentoId}:${movimiento}:${version}`,
    });
    return r.ok ? 'enviado' : 'fallo';
  } catch (e) {
    logger.warn('carta_porte_docs.movimiento_no_avisado', { tenantId, documentoId, movimiento, err: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    return 'fallo';
  }
}
