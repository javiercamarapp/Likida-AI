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

/**
 * Libera la marca de `llm_alerta_tope` cuando el aviso NO salió, para que el siguiente barrido pueda reintentarlo.
 * `service_role` tiene `delete` sobre la tabla (0990). `null` = el cliente no tiene `from`.
 */
export async function rpcLiberarAlertaTope(tenantId: string, dia: string, nivel: 80 | 100): Promise<RespuestaRpc | null> {
  const admin = supabaseAdmin() as unknown as {
    from?: (t: string) => { delete: () => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => PromiseLike<RespuestaRpc> } } } };
  };
  if (typeof admin.from !== 'function') return null;
  return acotada(admin.from('llm_alerta_tope').delete().eq('tenant_id', tenantId).eq('dia', dia).eq('nivel', nivel), 'liberarAlertaTope');
}

/** `uso_llm_dia_por_flota`: filas `{ tenant_id, usado_usd }` del día MX. `null` = el cliente no tiene RPC. */
export async function rpcUsoLlmDiaPorFlota(dia: string): Promise<RespuestaRpc | null> {
  const admin = supabaseAdmin() as unknown as RpcCliente;
  if (typeof admin.rpc !== 'function') return null;
  return acotada(admin.rpc('uso_llm_dia_por_flota', { p_dia: dia }), 'usoLlmDiaPorFlota');
}

export interface FilaAlertaTope {
  tenantId: string; tenantNombre: string; dia: string; nivel: 80 | 100; usoUsd: number; topeUsd: number; origenTope: string; creadoEn: string;
}

/**
 * Los avisos de tope diario ya emitidos (0990), de los últimos `dias` días del calendario de México, de TODAS las flotas: es la
 * lectura del superadmin (/admin/consumo). LANZA si la base no responde — «ningún aviso» y «no se pudo leer» no son lo mismo.
 */
export async function listarAlertasTopeRecientes(desdeDia: string, limite = 60): Promise<FilaAlertaTope[]> {
  const r = await acotada(
    supabaseAdmin().from('llm_alerta_tope')
      .select('tenant_id, dia, nivel, uso_usd, tope_usd, origen_tope, creado_en, tenant(nombre)')
      .gte('dia', desdeDia)
      .order('dia', { ascending: false }).order('creado_en', { ascending: false }).order('tenant_id', { ascending: false })
      .limit(Math.min(Math.max(1, limite), 200)),
    'listarAlertasTopeRecientes',
  );
  if (r.error) throw new Error(`listarAlertasTopeRecientes: ${r.error.message}`);
  return (r.data ?? []).map((f) => {
    const t = f.tenant as { nombre?: string } | Array<{ nombre?: string }> | null;
    const nombre = Array.isArray(t) ? t[0]?.nombre : t?.nombre;
    return {
      tenantId: String(f.tenant_id), tenantNombre: nombre ?? '—', dia: String(f.dia), nivel: Number(f.nivel) === 100 ? 100 : 80,
      usoUsd: Number(f.uso_usd), topeUsd: Number(f.tope_usd), origenTope: String(f.origen_tope), creadoEn: String(f.creado_en),
    };
  });
}
