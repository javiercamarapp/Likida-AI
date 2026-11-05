// Acceso a datos de las alertas de tope de IA (0990). Vive en `repo.ts` porque es la frontera declarada de acceso a Supabase
// (`frontera_datos_guardiana.test.ts` congela cuántos módulos llaman a la base por fuera de ella).
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import type { OrigenTopeTenant } from './budget';

type RpcCliente = {
  rpc?: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
export type RespuestaRpc = { data: unknown; error: { message: string } | null };

/** `registrar_alerta_tope_llm`: `data === true` solo a quien insertó la fila (el que debe avisar). `null` = el cliente no tiene RPC. */
export async function rpcRegistrarAlertaTope(
  tenantId: string, dia: string, nivel: 80 | 100, usoUsd: number, topeUsd: number, origen: OrigenTopeTenant | string,
): Promise<RespuestaRpc | null> {
  const admin = supabaseAdmin() as unknown as RpcCliente;
  if (typeof admin.rpc !== 'function') return null;
  return acotada(admin.rpc('registrar_alerta_tope_llm', {
    p_tenant_id: tenantId, p_dia: dia, p_nivel: nivel,
    p_uso_usd: Number(Math.max(0, usoUsd).toFixed(6)), p_tope_usd: Number(topeUsd.toFixed(6)), p_origen: origen,
  }), 'registrarAlertaTope');
}

/** `uso_llm_dia_por_flota`: filas `{ tenant_id, usado_usd }` del día MX. `null` = el cliente no tiene RPC. */
export async function rpcUsoLlmDiaPorFlota(dia: string): Promise<RespuestaRpc | null> {
  const admin = supabaseAdmin() as unknown as RpcCliente;
  if (typeof admin.rpc !== 'function') return null;
  return acotada(admin.rpc('uso_llm_dia_por_flota', { p_dia: dia }), 'usoLlmDiaPorFlota');
}
