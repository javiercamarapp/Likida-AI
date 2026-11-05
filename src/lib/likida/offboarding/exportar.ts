import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { tablasExportables } from './mapa_datos';
import { armarPaquete, type LecturaTabla, type Paquete } from './paquete';

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIÓN / OFFBOARDING DE UNA FLOTA — F9, CT-DAT-16.
//
// APAGADA por omisión (`LIKIDA_OFFBOARDING_EXPORTACION=activo`): escribe una constancia en `tenant_exportacion` (0998, que Javier
// aplica a mano) y su alcance y retención dependen de la decisión D7. Solo LEE los datos de la flota y deja la constancia: NO borra ni
// anonimiza nada — la purga posterior se hace con la retención ya decidida, no aquí.
//
// Fallar cerrado y decirlo: una tabla que no se pudo leer, o que topó el límite, queda en el manifiesto como error/truncada y el
// paquete sale `completo: false`; en ese caso NO se registra constancia de entrega.
// ═══════════════════════════════════════════════════════════════════════════

export const PAGINA = 1000;
export const TOPE_FILAS_POR_TABLA = 50_000;

export function offboardingActivo(env: Record<string, string | undefined> = process.env): boolean {
  return (env.LIKIDA_OFFBOARDING_EXPORTACION ?? '').trim().toLowerCase() === 'activo';
}

type Cliente = ReturnType<typeof supabaseAdmin>;

async function leerTabla(sb: Cliente, tabla: string, tenantId: string): Promise<LecturaTabla> {
  const filas: Array<Record<string, unknown>> = [];
  for (let desde = 0; desde < TOPE_FILAS_POR_TABLA; desde += PAGINA) {
    const q = tabla === 'tenant'
      ? sb.from(tabla).select('*').eq('id', tenantId)
      : sb.from(tabla).select('*').eq('tenant_id', tenantId);
    const { data, error } = await q.order('id', { ascending: true }).range(desde, desde + PAGINA - 1);
    if (error) return { tabla, error: error.message };
    const pag = (data ?? []) as Array<Record<string, unknown>>;
    filas.push(...pag);
    if (pag.length < PAGINA) return { tabla, filas };
  }
  return { tabla, filas, truncada: true };
}

export type ResultadoExportacion =
  | { ok: true; paquete: Paquete; exportacionId: string }
  | { ok: false; motivo: string; paquete?: Paquete };

export async function exportarFlota(
  tenantId: string, solicitadoPor: string, opts: { sb?: Cliente; env?: Record<string, string | undefined> } = {},
): Promise<ResultadoExportacion> {
  if (!offboardingActivo(opts.env)) return { ok: false, motivo: 'La exportación de flota está apagada (decisión D7 pendiente).' };
  const sb = opts.sb ?? supabaseAdmin();
  const lecturas: LecturaTabla[] = [];
  for (const t of tablasExportables()) lecturas.push(await leerTabla(sb, t, tenantId));
  const paquete = armarPaquete(tenantId, lecturas);
  if (!paquete.manifiesto.completo) {
    const malas = paquete.manifiesto.archivos.filter((a) => a.estado !== 'ok').map((a) => `${a.tabla} (${a.estado})`);
    logger.warn('offboarding.incompleto', { tenant: tenantId, tablas: malas });
    return { ok: false, motivo: `El paquete quedó incompleto: ${malas.join(', ')}. No se registra constancia.`, paquete };
  }
  const { data, error } = await sb.from('tenant_exportacion').insert({
    tenant_id: tenantId, solicitado_por: solicitadoPor, filas_total: paquete.manifiesto.filas_total,
    manifiesto: paquete.manifiesto, huella_sha256: paquete.huellaManifiesto,
  }).select('id').single();
  if (error || !data) return { ok: false, motivo: `No se pudo registrar la constancia: ${error?.message ?? 'sin respuesta'}.`, paquete };
  return { ok: true, paquete, exportacionId: String((data as { id: string }).id) };
}
