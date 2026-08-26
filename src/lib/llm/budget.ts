import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

export class LlmBudgetExceededError extends Error {
  constructor(public scope: 'run' | 'tenant', public requestedUsd: number, public limitUsd: number) {
    super(`presupuesto de IA agotado para ${scope}: se requieren $${requestedUsd.toFixed(6)} USD y el límite es $${limitUsd.toFixed(6)} USD`);
    this.name = 'LlmBudgetExceededError';
  }
}

export interface LlmBudget {
  tenantId: string;
  runId: string;
  maxRunUsd: number;
  maxTenantDailyUsd: number;
  reservadoRunUsd: number;
}

export interface LlmBudgetLimits {
  maxRunUsd?: number;
  maxTenantDailyUsd?: number;
}

export interface LlmBudgetReservation {
  id: string;
  amountUsd: number;
  persisted?: boolean;
  settled?: boolean;
}

function positiveEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * El tenant de presupuesto es parte de la frontera de seguridad, no una
 * configuración global. En producción también debe ser UUID porque la RPC
 * central recibe `uuid`; en tests aceptamos identificadores cortos para que
 * cada caso pueda inyectar su propio tenant sin levantar Postgres.
 */
// Mismo patrón que `esUuidValido` (`intake/cfdi.ts`) y el resto del repo
// (`viajes_registro.ts`, `operacion.ts`, `qa-tipos.ts`…): solo la FORMA
// 8-4-4-4-12 en hex. NO exigir el nibble de versión/variante RFC4122
// ([1-5].../[89ab]...) — `tenant.id` de G3M, la única flota en producción,
// es `11111111-1111-1111-1111-111111111111`, un UUID a propósito (ver
// `seed.sql`) que NO trae esos nibbles. La versión estricta de este check
// (añadida en el endurecimiento «Enterprise», 24-ago) rechazaba ese ID en
// producción con `NODE_ENV=production`, así que TODA llamada al agente que
// pidiera presupuesto de IA para G3M fallaba con "tenant inválido" y el
// operador recibía el genérico "se me trabó el sistema" — verificado en
// logs de producción el 25-ago (`agent.fail`, err "presupuesto_llm: tenant
// inválido", huella de tenant igual a `huellaId('11111111-...-111111111111')`).
export function requireLlmBudgetTenant(tenantId: string | null | undefined): string {
  const value = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!value) throw new Error('presupuesto_llm: tenant requerido');
  if (process.env.NODE_ENV === 'production'
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('presupuesto_llm: tenant inválido');
  }
  return value;
}

export function createLlmBudget(
  tenantId: string | null | undefined,
  runId: string,
  limits: LlmBudgetLimits = {},
): LlmBudget {
  const resolvedTenantId = requireLlmBudgetTenant(tenantId);
  return {
    tenantId: resolvedTenantId,
    runId,
    // Seis rondas de Sonnet con 4k de salida caben en este techo; el límite
    // sigue siendo duro y puede bajarse sin desplegar.
    maxRunUsd: limits.maxRunUsd && limits.maxRunUsd > 0
      ? limits.maxRunUsd
      : positiveEnv(process.env.LIKIDA_LLM_RUN_BUDGET_USD, 0.50),
    maxTenantDailyUsd: limits.maxTenantDailyUsd && limits.maxTenantDailyUsd > 0
      ? limits.maxTenantDailyUsd
      : positiveEnv(process.env.LIKIDA_LLM_TENANT_DAILY_BUDGET_USD, 5.00),
    reservadoRunUsd: 0,
  };
}

/** Reserva antes de llamar al proveedor. La RPC bloquea por tenant para evitar carreras entre workers. */
export async function reserveLlmBudget(budget: LlmBudget, amountUsd: number): Promise<LlmBudgetReservation> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('reserva de IA inválida');
  if (budget.reservadoRunUsd + amountUsd > budget.maxRunUsd + 1e-9) {
    throw new LlmBudgetExceededError('run', budget.reservadoRunUsd + amountUsd, budget.maxRunUsd);
  }

  const id = randomUUID();
  const admin = supabaseAdmin() as unknown as {
    rpc?: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  // Los tests de integración mockean Supabase con el contrato que necesitaba
  // el flujo anterior. En producción el cliente real siempre expone `rpc`; si
  // falta fuera de Vitest se falla cerrado y no se llama al proveedor.
  if (typeof admin.rpc !== 'function') {
    if (process.env.NODE_ENV === 'test') {
      budget.reservadoRunUsd += amountUsd;
      return { id, amountUsd, persisted: false };
    }
    throw new Error('reservar_presupuesto_llm: cliente Supabase sin RPC de presupuesto');
  }
  const { data, error } = await acotada(admin.rpc('reservar_presupuesto_llm', {
    p_reserva_id: id,
    p_tenant_id: budget.tenantId,
    p_run_id: budget.runId,
    p_reserva_usd: Number(amountUsd.toFixed(6)),
    p_tope_run_usd: Number(budget.maxRunUsd.toFixed(6)),
    p_tope_tenant_usd: Number(budget.maxTenantDailyUsd.toFixed(6)),
  }), 'reservarPresupuestoLlm');
  if (error) throw new Error(`reservar_presupuesto_llm: ${error.message}`);
  if (data !== true) throw new LlmBudgetExceededError('tenant', amountUsd, budget.maxTenantDailyUsd);
  budget.reservadoRunUsd += amountUsd;
  return { id, amountUsd, persisted: true };
}

/** Ajusta la reserva al costo real; ante una excepción conserva la reserva. */
export async function settleLlmBudget(
  budget: LlmBudget,
  reservation: LlmBudgetReservation,
  actualUsd: number,
): Promise<void> {
  if (reservation.settled) return;
  const real = Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : reservation.amountUsd;
  budget.reservadoRunUsd = Math.max(0, budget.reservadoRunUsd - reservation.amountUsd + real);
  if (reservation.persisted === false) return;
  const admin = supabaseAdmin() as unknown as {
    rpc?: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>;
  };
  if (typeof admin.rpc !== 'function') throw new Error('liquidar_presupuesto_llm: cliente Supabase sin RPC de presupuesto');
  const { data, error } = await acotada(admin.rpc('liquidar_presupuesto_llm', {
    p_reserva_id: reservation.id,
    p_costo_real_usd: Number(real.toFixed(6)),
  }), 'liquidarPresupuestoLlm');
  if (error) throw new Error(`liquidar_presupuesto_llm: ${error.message}`);
  if (data === false) throw new Error('liquidar_presupuesto_llm: reserva no activa o inexistente');
  reservation.settled = true;
}
