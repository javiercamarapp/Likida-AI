import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

const LEASE_MS = Number(process.env.LIKIDA_TOOL_IDEMPOTENCY_LEASE_MS) || 120_000;

export type MutationClaim =
  | { kind: 'execute'; token: string }
  | { kind: 'cached'; result: unknown }
  | { kind: 'busy' };

type RpcResult = { data: unknown; error: { message: string } | null };

function leaseSeconds(): number {
  // La duración es configuración, no una fecha calculada por la app. La
  // expiración absoluta la calcula PostgreSQL con clock_timestamp().
  return Math.max(1, Math.min(900, Math.ceil(LEASE_MS / 1_000)));
}

function rpcRow(data: unknown): { kind: string; token: string | null; result: unknown } | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== 'object') return null;
  const row = candidate as Record<string, unknown>;
  return {
    kind: typeof row.kind === 'string' ? row.kind : '',
    token: typeof row.token === 'string' ? row.token : null,
    result: row.result,
  };
}

async function mutationRpc(name: string, args: Record<string, unknown>, etiqueta: string): Promise<RpcResult> {
  const admin = supabaseAdmin() as unknown as {
    rpc?: (rpcName: string, rpcArgs: Record<string, unknown>) => PromiseLike<RpcResult>;
  };
  if (typeof admin.rpc !== 'function') {
    throw new Error(`${name}: cliente Supabase sin RPC de idempotencia`);
  }
  return acotada(admin.rpc(name, args), etiqueta);
}

/** Claim durable, cross-process. El reloj autoritativo vive en PostgreSQL. */
export async function claimMutation(tenantId: string, effectKey: string, toolName: string): Promise<MutationClaim> {
  const { data, error } = await mutationRpc('claim_agente_mutacion', {
    p_tenant_id: tenantId,
    p_effect_key: effectKey,
    p_tool_name: toolName,
    p_lease_seconds: leaseSeconds(),
  }, 'claimMutation');
  if (error) throw new Error(`claimMutation: ${error.message}`);
  const row = rpcRow(data);
  if (!row) throw new Error('claimMutation: RPC sin resultado durable');
  if (row.kind === 'execute' && row.token) return { kind: 'execute', token: row.token };
  if (row.kind === 'cached') return { kind: 'cached', result: row.result };
  if (row.kind === 'busy') return { kind: 'busy' };
  throw new Error('claimMutation: respuesta RPC inválida');
}

/** Renueva un lease vigente usando el reloj de PostgreSQL. */
export async function renewMutation(tenantId: string, effectKey: string, token: string): Promise<boolean> {
  const { data, error } = await mutationRpc('renew_agente_mutacion', {
    p_tenant_id: tenantId,
    p_effect_key: effectKey,
    p_owner_token: token,
    p_lease_seconds: leaseSeconds(),
  }, 'renewMutation');
  if (error) throw new Error(`renewMutation: ${error.message}`);
  return data === true;
}

export async function completeMutation(
  tenantId: string,
  effectKey: string,
  token: string,
  result: unknown,
): Promise<void> {
  const { data, error } = await mutationRpc('complete_agente_mutacion', {
    p_tenant_id: tenantId,
    p_effect_key: effectKey,
    p_owner_token: token,
    p_result: result ?? null,
  }, 'completeMutation');
  if (error) throw new Error(`completeMutation: ${error.message}`);
  if (data !== true) throw new Error('completeMutation: se perdió el fencing token');
}

export async function failMutation(tenantId: string, effectKey: string, token: string, errorMessage: string): Promise<void> {
  const { data, error } = await mutationRpc('fail_agente_mutacion', {
    p_tenant_id: tenantId,
    p_effect_key: effectKey,
    p_owner_token: token,
    p_error: errorMessage.slice(0, 1000),
  }, 'failMutation');
  if (error) throw new Error(`failMutation: ${error.message}`);
  if (data !== true) throw new Error('failMutation: se perdió el fencing token');
}
