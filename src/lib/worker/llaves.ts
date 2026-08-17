import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registrarEventoSeguridad } from '@/lib/seguridad/eventos';

// ═══════════════════════════════════════════════════════════════════════════
// EL RESOLVER DE LLAVES DE WORKER (0135).
//
// FALLAR CERRADO en todo camino dudoso: sin llave, llave desconocida, llave
// revocada o capacidad que no alcanza → rechazo con el MISMO mensaje (no se
// le dice a quien sondea qué llaves existen ni qué alcanzan), y fila en la
// telemetría de seguridad. El last_used_at es best-effort.
// ═══════════════════════════════════════════════════════════════════════════

export type CapacidadWorker = 'bus.latido' | 'bus.pieza' | 'bus.catalogo' | 'bus.ordenes';
export const CAPACIDADES_WORKER: readonly CapacidadWorker[] =
  ['bus.latido', 'bus.pieza', 'bus.catalogo', 'bus.ordenes'];

export function hashLlaveWorker(llave: string): string {
  return createHash('sha256').update(llave, 'utf8').digest('hex');
}

export type ResolucionWorker =
  | { ok: true; workerId: string; nombre: string }
  | { ok: false; error: string };

const RECHAZO = 'Llave de worker inválida o sin alcance para esta operación.';

export async function resolverLlaveWorker(
  llave: string | null,
  capacidad: CapacidadWorker,
): Promise<ResolucionWorker> {
  if (!llave || !llave.startsWith('lkw_') || llave.length < 20) {
    void registrarEventoSeguridad({ origen: 'auth', tipo: 'acceso_denegado', detalle: { canal: 'worker', causa: 'sin_llave', capacidad } });
    return { ok: false, error: RECHAZO };
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.from('worker_llave')
    .select('id, nombre, capacidades, revocada_en')
    .eq('hash', hashLlaveWorker(llave))
    .maybeSingle();
  // Un error de la base NO se lee como "llave mala": es 503 del llamador —
  // pero tampoco se deja pasar. Se devuelve rechazo con causa distinta.
  if (error) return { ok: false, error: 'No se pudo validar la llave — reintenta.' };
  if (!data || data.revocada_en || !(data.capacidades as string[]).includes(capacidad)) {
    void registrarEventoSeguridad({
      origen: 'auth', tipo: 'acceso_denegado',
      actor: `lkw…${llave.slice(-6)}`,
      detalle: { canal: 'worker', causa: !data ? 'desconocida' : data.revocada_en ? 'revocada' : 'sin_capacidad', capacidad },
    });
    return { ok: false, error: RECHAZO };
  }
  void admin.from('worker_llave').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
    .then(() => undefined, () => undefined);
  return { ok: true, workerId: data.id, nombre: data.nombre };
}
