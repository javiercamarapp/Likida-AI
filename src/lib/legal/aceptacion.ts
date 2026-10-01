import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import {
  MANDATO_AUTOFACTURACION, versionVigente, type DocumentoLegal,
} from './documentos';

// ═══════════════════════════════════════════════════════════════════════════
// LA CAPA TS DE `aceptacion_legal` (0443, auditoría ola 1 #48).
//
// Toda decisión vive en la base (pertenencia a la flota, rol, idempotencia,
// unicidad del mandato); aquí solo se llama y se traduce. Dos reglas de la casa:
//   · lo que se LEE para decidir lanza o falla CERRADO (`mandatoFlotaVigente`
//     devuelve false ante una base caída: sin evidencia, no se emite — mejor un
//     ensayo de más que un CFDI sin mandato);
//   · lo que se MUESTRA no se inventa: `estadoLegalDeUsuario` devuelve `null` si
//     no pudo leer, y la pantalla lo dice en vez de pintar «todo aceptado».
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoAceptacion {
  ok: boolean;
  /** `false` = ya estaba aceptada (idempotente), no es un error. */
  registrada?: boolean;
  motivo?: string;
}

function commitDesplegado(): string | null {
  const c = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return c ? c.slice(0, 64) : null;
}

/** Registra la aceptación de la versión VIGENTE de un documento por esta persona. */
export async function registrarAceptacion(
  tenantId: string, userId: string, documento: DocumentoLegal,
): Promise<ResultadoAceptacion> {
  const { data, error } = await acotada(supabaseAdmin().rpc('registrar_aceptacion_legal', {
    p_tenant: tenantId,
    p_user: userId,
    p_documento: documento,
    p_version: versionVigente(documento),
    p_hash: documento === 'mandato_autofacturacion' ? MANDATO_AUTOFACTURACION.hashSha256 : null,
    p_commit: commitDesplegado(),
  }), 'legal.registrar');
  if (error) {
    logger.error('legal.aceptacion_no_registrada', { tenantId, documento, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la aceptación. Intenta de nuevo.' };
  }
  const r = (data ?? {}) as { ok?: boolean; registrada?: boolean; motivo?: string };
  if (r.ok !== true) return { ok: false, motivo: r.motivo ?? 'La base no explicó el rechazo.' };
  return { ok: true, registrada: r.registrada === true };
}

export async function revocarMandato(tenantId: string, userId: string): Promise<ResultadoAceptacion> {
  const { data, error } = await acotada(supabaseAdmin().rpc('revocar_mandato_autofacturacion', {
    p_tenant: tenantId, p_user: userId,
  }), 'legal.revocar_mandato');
  if (error) {
    logger.error('legal.mandato_no_revocado', { tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo retirar el mandato. Intenta de nuevo.' };
  }
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  return r.ok === true ? { ok: true } : { ok: false, motivo: r.motivo ?? 'La base no explicó el rechazo.' };
}

/**
 * EL CANDADO DE EMISIÓN. `true` solo si la flota aceptó la versión VIGENTE del
 * mandato y no la retiró. Cualquier duda (base caída, respuesta rara) es `false`:
 * se falla cerrado y se dice.
 */
export async function mandatoFlotaVigente(tenantId: string): Promise<boolean> {
  try {
    const { data, error } = await acotada(supabaseAdmin().rpc('mandato_autofacturacion_vigente', {
      p_tenant: tenantId, p_version: MANDATO_AUTOFACTURACION.version,
    }), 'legal.mandato_vigente');
    if (error) {
      logger.error('legal.mandato_ilegible', { tenantId, err: error.message });
      return false;
    }
    return data === true;
  } catch (e) {
    logger.error('legal.mandato_ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export interface AceptacionFila {
  documento: DocumentoLegal;
  version: string;
  aceptadoEn: string;
  /** Quién aceptó; `null` si la cuenta se canceló después (ARCO). */
  userId: string | null;
  revocadoEn: string | null;
}

/** Las aceptaciones VIGENTES de la flota. LANZA ante un error de lectura. */
export async function aceptacionesDeFlota(tenantId: string): Promise<AceptacionFila[]> {
  const { data, error } = await acotada(supabaseAdmin().from('aceptacion_legal')
    .select('documento, version, aceptado_en, user_id, revocado_en')
    .eq('tenant_id', tenantId)
    .order('aceptado_en', { ascending: false })
    .order('id')
    .limit(200), 'legal.aceptaciones');
  if (error) throw new Error(`aceptacion_legal: ${error.message}`);
  return (data ?? []).map((f) => ({
    documento: f.documento as DocumentoLegal,
    version: String(f.version),
    aceptadoEn: String(f.aceptado_en),
    userId: (f.user_id as string | null) ?? null,
    revocadoEn: (f.revocado_en as string | null) ?? null,
  }));
}

/** ¿Este usuario ya aceptó la versión vigente? (solo para Términos y Aviso). */
export function pendientesDeUsuario(filas: AceptacionFila[], userId: string): DocumentoLegal[] {
  return (['terminos', 'aviso_privacidad'] as const).filter((d) =>
    !filas.some((f) => f.documento === d && f.userId === userId && f.version === versionVigente(d) && f.revocadoEn === null));
}

/** El mandato vigente de la flota, si lo hay (quién y cuándo). */
export function mandatoDe(filas: AceptacionFila[]): AceptacionFila | null {
  return filas.find((f) => f.documento === 'mandato_autofacturacion'
    && f.version === MANDATO_AUTOFACTURACION.version && f.revocadoEn === null) ?? null;
}
