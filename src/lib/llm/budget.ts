import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// D.23 (frente de escala) — EL PRESUPUESTO TIENE DIMENSIÓN DE PROPÓSITO.
//
// Antes todo el gasto de modelo de un tenant salía de la misma bolsa diaria:
// el OCR barato de un lote grande podía vaciar el techo antes de que el
// chofer mandara su ticket, y el camino interactivo —el que tiene a una
// persona esperando— se quedaba sin servicio por un proceso de fondo.
//
// Tres propósitos (dominio cerrado, el mismo CHECK de la 0244):
//   · 'interactivo' — hay una persona esperando AHORA: el turno de WhatsApp
//     del chofer (agente, OCR de SU ticket, su audio), los chats del
//     dashboard y las subidas manuales.
//   · 'ocr_lote'    — extracción de comprobantes en fondo (piloto de visión).
//   · 'fondo'       — agentes de back office (runner, analista, redactor).
//
// La RESERVA: 'ocr_lote' y 'fondo' solo gastan hasta (tope_tenant − reserva);
// 'interactivo' puede usar el techo completo. Cuando el fondo toca su parte,
// la RPC devuelve 'tope_proposito' y aquí se FALLA CERRADO con nombre —
// jamás un número inventado ni un 0 silencioso. El propósito es un parámetro
// OBLIGATORIO de `createLlmBudget`: un llamador nuevo tiene que decidir en
// qué carril corre, no heredar uno en silencio.
// ═══════════════════════════════════════════════════════════════════════════

export type PropositoIa = 'interactivo' | 'ocr_lote' | 'fondo';

const MENSAJE_POR_SCOPE = {
  run: (pedido: string, limite: string) =>
    `presupuesto de IA agotado para esta corrida: se requieren ${pedido} USD y el límite es ${limite} USD`,
  tenant: (pedido: string, limite: string) =>
    `presupuesto de IA del día agotado para esta flota: se requieren ${pedido} USD y el techo diario es ${limite} USD`,
  proposito: (pedido: string, limite: string) =>
    `presupuesto de IA de fondo agotado por hoy (se requieren ${pedido} USD y la parte de fondo es ${limite} USD): ` +
    'la reserva restante es del camino interactivo — el chofer no se queda sin servicio por un lote de fondo. El trabajo de fondo reintenta en su siguiente corrida.',
} as const;

export class LlmBudgetExceededError extends Error {
  constructor(public scope: 'run' | 'tenant' | 'proposito', public requestedUsd: number, public limitUsd: number) {
    super(MENSAJE_POR_SCOPE[scope](`$${requestedUsd.toFixed(6)}`, `$${limitUsd.toFixed(6)}`));
    this.name = 'LlmBudgetExceededError';
  }
}

export interface LlmBudget {
  tenantId: string;
  runId: string;
  /** En qué carril corre este gasto — decide qué techo lo frena. */
  proposito: PropositoIa;
  maxRunUsd: number;
  maxTenantDailyUsd: number;
  /** Parte del techo diario que SOLO el camino interactivo puede tocar. */
  reservaInteractivoUsd: number;
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

const PROPOSITOS: readonly PropositoIa[] = ['interactivo', 'ocr_lote', 'fondo'];

/**
 * Qué fracción del techo diario queda reservada para el camino interactivo.
 * 0.4 por defecto: con el techo default de $5.00/día, $2.00 que ningún lote
 * de fondo puede tocar. Ajustable sin desplegar; se acota a [0, 1].
 */
function fraccionReservaInteractivo(): number {
  const parsed = Number(process.env.LIKIDA_LLM_RESERVA_INTERACTIVO_PCT);
  if (!Number.isFinite(parsed)) return 0.4;
  return Math.min(1, Math.max(0, parsed));
}

/** Los topes vigentes por defecto — para que el panel /admin/consumo enseñe el techo real, no uno recordado. */
export function topesPresupuestoIa(): { topeTenantDiaUsd: number; reservaInteractivoUsd: number; fraccionReserva: number } {
  const topeTenantDiaUsd = positiveEnv(process.env.LIKIDA_LLM_TENANT_DAILY_BUDGET_USD, 5.00);
  const fraccionReserva = fraccionReservaInteractivo();
  return {
    topeTenantDiaUsd,
    reservaInteractivoUsd: Number((topeTenantDiaUsd * fraccionReserva).toFixed(6)),
    fraccionReserva,
  };
}

export function createLlmBudget(
  tenantId: string | null | undefined,
  runId: string,
  proposito: PropositoIa,
  limits: LlmBudgetLimits = {},
): LlmBudget {
  const resolvedTenantId = requireLlmBudgetTenant(tenantId);
  // Fail-closed: un propósito fuera del dominio no se corrige a una cubeta —
  // se rechaza antes de gastar un centavo.
  if (!PROPOSITOS.includes(proposito)) {
    throw new Error(`presupuesto_llm: propósito desconocido: ${String(proposito)}`);
  }
  const maxTenantDailyUsd = limits.maxTenantDailyUsd && limits.maxTenantDailyUsd > 0
    ? limits.maxTenantDailyUsd
    : positiveEnv(process.env.LIKIDA_LLM_TENANT_DAILY_BUDGET_USD, 5.00);
  return {
    tenantId: resolvedTenantId,
    runId,
    proposito,
    // Seis rondas de Sonnet con 4k de salida caben en este techo; el límite
    // sigue siendo duro y puede bajarse sin desplegar.
    maxRunUsd: limits.maxRunUsd && limits.maxRunUsd > 0
      ? limits.maxRunUsd
      : positiveEnv(process.env.LIKIDA_LLM_RUN_BUDGET_USD, 0.50),
    maxTenantDailyUsd,
    reservaInteractivoUsd: Number((maxTenantDailyUsd * fraccionReservaInteractivo()).toFixed(6)),
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
    // D.23 (0244): con los 8 argumentos nombrados, PostgREST resuelve el
    // overload nuevo — el que conoce el propósito y la reserva interactiva.
    p_proposito: budget.proposito,
    p_reserva_interactivo_usd: Number(budget.reservaInteractivoUsd.toFixed(6)),
  }), 'reservarPresupuestoLlm');
  if (error) throw new Error(`reservar_presupuesto_llm: ${error.message}`);
  // La RPC dice CUÁL techo frenó — y aquí se le pone el monto de ese techo,
  // no uno genérico. Cualquier respuesta fuera del contrato LANZA: tratarla
  // como éxito sería gastar sin reserva.
  if (data === 'tope_tenant') throw new LlmBudgetExceededError('tenant', amountUsd, budget.maxTenantDailyUsd);
  if (data === 'tope_proposito') {
    throw new LlmBudgetExceededError('proposito', amountUsd, Math.max(0, budget.maxTenantDailyUsd - budget.reservaInteractivoUsd));
  }
  if (data === 'tope_run') throw new LlmBudgetExceededError('run', amountUsd, budget.maxRunUsd);
  if (data !== 'ok') throw new Error(`reservar_presupuesto_llm: respuesta inesperada (${JSON.stringify(data)}) — ¿migración 0244 sin aplicar?`);
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
