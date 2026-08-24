// ═══════════════════════════════════════════════════════════════════════════
// EL RUNNER NIVEL 2 (0123) — la autonomía ACOTADA que Javier ordenó el
// 16-ago-2026, anulando el diferimiento del diseño del copiloto §4.
//
// EL ORQUESTADOR ES DETERMINISTA A PROPÓSITO — cero LLM en el despacho
// (la mitad determinista del mismo diseño: "las reglas calculan, el LLM
// redacta"). Quien gasta modelo es el AGENTE despachado, con su rol barato
// (models.ts `back_office`), y este módulo lo frena por CUATRO candados,
// todos fail-closed:
//   1. Kill switch global y por agente (interruptores 0110). Un agente
//      autónomo SIN kill switch declarado no corre — punto.
//   2. Opt-in `runner_habilitado` + estado 'vivo' + disparador 'cron'
//      (agente_definicion 0123) — apagable en la base sin deploy.
//   3. TECHO DE DINERO: presupuesto_dia_usd DECLARADO (NULL = no corre
//      solo) y reservado de forma atómica en el ledger central por tenant.
//      Sin tenant explícito o sin reserva durable, no se corre.
//   4. BACKPRESSURE: si la bandeja de aprobación ya acumula piezas sin
//      resolver, el runner no fabrica más — un humano que no aprueba es la
//      señal de parar, no de insistir.
//
// La SALIDA de todo agente del runner es la cola de aprobación — el runner
// jamás toca un canal de envío. El tope de ENVÍO diario vive aparte, en la
// única puerta de salida (cola.ts).
// ═══════════════════════════════════════════════════════════════════════════
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { estaApagado, INTERRUPTORES, type NombreInterruptor } from '../interruptores';
import { hoyMx } from '@/lib/formato';
import { LlmBudgetExceededError, createLlmBudget, type LlmBudget } from '@/lib/llm/budget';
import { redactarCorreoFrio } from './redactor';
import { logger } from '@/lib/logger';

/** Piezas que una corrida del runner fabrica como máximo por agente. */
export function topePiezasPorCorrida(): number {
  const v = Number(process.env.LIKIDA_RUNNER_PIEZAS_POR_CORRIDA);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5;
}

/** Pendientes en la bandeja a partir de los cuales el runner deja de
 *  fabricar (backpressure): aprobar es humano, y una bandeja desbordada es
 *  la señal de parar. */
export function topePendientesBandeja(): number {
  const v = Number(process.env.LIKIDA_RUNNER_TOPE_PENDIENTES);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 20;
}

export interface AgenteDelRunner {
  agente: string;
  resultado: 'corrio' | 'saltado';
  motivo?: string;
  piezas?: number;
  saltados?: number;
  costoUsd?: number;
}

export interface ResultadoRunner {
  apagadoGlobal: boolean;
  agentes: AgenteDelRunner[];
}

/** El gasto MEDIDO del agente hoy (día de México), USD. LANZA si la base no
 *  responde — el techo no se verifica a ciegas. */
export async function gastoDelDiaUsd(agente: string): Promise<number> {
  const diaMx = hoyMx();
  const inicioDia = new Date(`${diaMx}T00:00:00-06:00`).toISOString();
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_corrida')
    .select('costo_usd')
    .eq('agente', agente)
    .not('costo_usd', 'is', null)
    .gte('inicio', inicioDia)
    .limit(1000), 'runner.gasto_dia');
  if (error) throw new Error(`gastoDelDiaUsd: ${error.message}`);
  return ((data ?? []) as Array<{ costo_usd: unknown }>).reduce((s, f) => s + Number(f.costo_usd ?? 0), 0);
}

/** El lote del Redactor: fabrica hasta N piezas para prospectos en `nuevo`
 *  (los más viejos primero — los del SLA), cortando por la reserva/run central.
 *  Las guardas por prospecto (cadencia 48h, pieza pendiente, estado) viven
 *  DENTRO de redactarCorreoFrio — aquí solo se seleccionan candidatos. */
async function loteRedactor(budget: LlmBudget): Promise<{ piezas: number; saltados: number; costoUsd: number }> {
  const tope = topePiezasPorCorrida();
  // Overfetch ×4: varios candidatos rebotan en las guardas del redactor
  // (pieza pendiente, cadencia) y eso NO es fallo — es la guarda operando.
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, vendedor:vendedor_id(nombre)')
    .is('duplicado_de', null)
    .eq('estado', 'nuevo')
    .order('created_at', { ascending: true })
    .limit(tope * 4), 'runner.candidatos');
  if (error) throw new Error(`loteRedactor.candidatos: ${error.message}`);
  const candidatos = (data ?? []) as Array<{ id: string; vendedor: { nombre?: string } | null }>;

  let piezas = 0, saltados = 0, costoUsd = 0;
  for (const c of candidatos) {
    if (piezas >= tope) break;
    if (budget.reservadoRunUsd >= budget.maxRunUsd) break;
    try {
      const r = await redactarCorreoFrio(c.id, c.vendedor?.nombre?.trim() || 'Javier', 'cron', {
        tenantId: budget.tenantId,
        budget,
      });
      piezas += 1;
      costoUsd += r.costoUsd;
    } catch (e) {
      // La RPC central ya hizo la decisión atómica. No se trata como un
      // prospecto inválido ni se sigue fabricando: el techo es de la corrida.
      if (e instanceof LlmBudgetExceededError) break;
      // Guarda legítima o fallo puntual: se cuenta y se sigue — un prospecto
      // atorado no puede parar el lote entero. El detalle ya quedó en la
      // corrida/log del redactor.
      saltados += 1;
      logger.info('runner.redactor.saltado', { prospecto: c.id, motivo: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }
  return { piezas, saltados, costoUsd };
}

/**
 * UNA vuelta del runner: despacha cada agente habilitado que pase los cuatro
 * candados. Cada agente falla POR SU LADO — un agente roto no tumba a los
 * demás, y el motivo de cada salto queda dicho.
 */
export async function correrRunner(
  /**
   * M30 (auditoría 18): acotar la vuelta a UN agente. El copiloto enseñaba
   * "Voy a ejecutar `redactor`" y despachaba a todos los habilitados. Sin
   * argumento sigue siendo la vuelta completa del cron.
   */
  soloAgente?: string,
  /** Tenant autenticado/explicitamente asignado que paga esta corrida.
   *  `null`/ausente bloquea al Redactor; nunca se usa un env global. */
  budgetTenantId?: string | null,
): Promise<ResultadoRunner> {
  if (await estaApagado('global')) {
    return { apagadoGlobal: true, agentes: [] };
  }

  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_definicion')
    .select('id, presupuesto_dia_usd')
    .eq('estado', 'vivo')
    .eq('runner_habilitado', true)
    .eq('disparador', 'cron')
    .order('id'), 'runner.agentes');
  if (error) throw new Error(`correrRunner: ${error.message}`);
  const habilitados = ((data ?? []) as Array<{ id: string; presupuesto_dia_usd: number | null }>)
    .filter((a) => !soloAgente || a.id === soloAgente);

  const agentes: AgenteDelRunner[] = [];
  for (const a of habilitados) {
    // Candado 1 — el kill switch. Sin interruptor declarado NO corre: un
    // agente autónomo que no se puede apagar no existe en este producto.
    const interruptor = `agente:${a.id}`;
    if (!(INTERRUPTORES as readonly string[]).includes(interruptor)) {
      agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'sin kill switch declarado (interruptores.ts + CHECK 0110) — un autónomo inapagable no corre' });
      continue;
    }
    try {
      if (await estaApagado(interruptor as NombreInterruptor)) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'apagado desde Observabilidad/⌘K' });
        continue;
      }
    } catch {
      agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'no se pudo leer el interruptor — fail closed' });
      continue;
    }

    // Candado 3 — el techo de dinero, declarado y medido.
    if (a.presupuesto_dia_usd === null || a.presupuesto_dia_usd <= 0) {
      agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'sin presupuesto_dia_usd declarado — el runner no corre agentes sin techo' });
      continue;
    }
    // Candado 4 — backpressure de la bandeja (solo agentes que encolan).
    if (a.id === 'redactor') {
      if (!budgetTenantId) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'sin tenant explícito para presupuesto central — fail closed' });
        continue;
      }
      const { count, error: errPend } = await supabaseAdmin()
        .from('cola_aprobacion')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
        .eq('tipo', 'correo_frio');
      if (errPend || typeof count !== 'number') {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'no se pudo leer la bandeja — fail closed' });
        continue;
      }
      if (count >= topePendientesBandeja()) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: `bandeja con ${count} piezas sin resolver — aprobar es humano; el runner no fabrica encima` });
        continue;
      }

      try {
        const budget = createLlmBudget(budgetTenantId, randomUUID(), {
          maxTenantDailyUsd: a.presupuesto_dia_usd,
        });
        const r = await loteRedactor(budget);
        agentes.push({ agente: a.id, resultado: 'corrio', ...r });
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: e instanceof Error ? e.message.slice(0, 200) : 'fallo del lote' });
      }
      continue;
    }

    // Un agente habilitado sin motor despachable: se dice, no se finge.
    agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'sin motor despachable en el runner todavía — habilitarlo aquí exige su rama de despacho' });
  }

  return { apagadoGlobal: false, agentes };
}
