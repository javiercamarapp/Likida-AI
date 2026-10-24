import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// A37-S54-02 — «ESE DEPÓSITO YA ESTÁ CONCILIADO».
//
// El índice único de la bandeja (0237, `portal_pago_propuesta_unica_pendiente`) es PARCIAL sobre las PENDIENTES a propósito: una
// propuesta descartada no debe impedir que el cliente vuelva a registrar su depósito. El costo es que una propuesta ya
// CONCILIADA tampoco compite: el cliente (o un segundo clic horas después, o la misma referencia con otra ortografía) registra
// de nuevo la misma fecha, monto y referencia, entra otra pendiente, y el contralor genera un segundo abono REAL — la
// idempotencia de `conciliarPropuesta` es solo por `propuestaId`.
//
// Este módulo responde UNA pregunta: ¿ya existe, en `pago_recibido` de ESTA factura, un abono con la misma fecha, el mismo monto
// y una referencia equivalente? Toda propuesta conciliada tiene su abono (`pago_id`), así que mirar el abono cubre también a las
// propuestas conciliadas y a los abonos capturados a mano. Vive aparte y ligero (solo `supabaseAdmin`) porque
// `portal_pago_propuesta.ts` lo importa desde la ruta pública y no debe arrastrar la cadena de facturación.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La referencia bancaria reducida a lo que identifica el movimiento: mayúsculas y solo letras y dígitos. «spei-8891 »,
 * «SPEI 8891» y «Spei8891» son el mismo depósito. Vacío = no hay con qué comparar (nunca coincide).
 */
export function referenciaNormalizada(r: string | null | undefined): string {
  return (r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * El id del abono equivalente que ya existe en la factura, o `null`. LANZA si no pudo preguntar: cada llamador decide si ese
 * silencio es fail-open (la ruta pública, que tiene detrás el índice y la revisión humana) o fail-closed (conciliar dinero).
 *
 * `excluirPropuestaId`: el abono de ESA propuesta no cuenta como duplicado (el rescate de una conciliación que murió entre crear
 * el abono y sellar la propuesta tiene que poder terminar).
 */
export async function abonoEquivalente(
  tenantId: string,
  p: { facturaId: string; fecha: string; monto: number; referencia: string },
  excluirPropuestaId?: string,
): Promise<string | null> {
  const ref = referenciaNormalizada(p.referencia);
  if (ref === '') return null;
  const { data, error } = await acotada(supabaseAdmin().from('pago_recibido')
    .select('id, referencia, propuesta_id')
    .eq('tenant_id', tenantId).eq('factura_id', p.facturaId)
    .eq('fecha', p.fecha).eq('monto', p.monto)
    .order('id').limit(50), 'portal_pago.abono_equivalente');
  if (error) throw new Error(`abonoEquivalente: ${error.message}`);
  for (const f of (Array.isArray(data) ? data : []) as Array<{ id?: unknown; referencia?: unknown; propuesta_id?: unknown }>) {
    if (excluirPropuestaId && String(f.propuesta_id ?? '') === excluirPropuestaId) continue;
    if (referenciaNormalizada(typeof f.referencia === 'string' ? f.referencia : null) === ref) return String(f.id);
  }
  return null;
}
