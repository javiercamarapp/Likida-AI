// Runner: corre un agente = carga su config + tools + prompt y ejecuta el
// ciclo de tool-calling con el contexto del tenant/operador.

import type OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { generateWithTools, type ToolCallRecord, type ToolExecutor } from '@/lib/llm/openrouter';
import { ROLE_PARAMS } from '@/lib/llm/models';
import { toolSchemas, makeExecutor, type ToolContext } from '@/lib/llm/tool-executor';
import { logger } from '@/lib/logger';
import { combineAbortSignals } from '@/lib/llm/runtime-signal';
import { createLlmBudget } from '@/lib/llm/budget';
import { AGENT_REGISTRY } from './registry';
import { getSystemPrompt } from './prompts';
import type { AgentName, TenantContext } from './types';

/**
 * TOO-C17-C1 (auditoría 32) — OFRECER NO ES ACOTAR.
 *
 * `toolSchemas(config.tools)` decide lo que el modelo VE, pero `executeTool`
 * resuelve el nombre contra el `REGISTRY` global del módulo, así que el
 * ejecutor crudo corre cualquier tool que alguien haya registrado en el
 * proceso. Y en el proceso de WhatsApp hay muchas: `processor.ts` importa
 * `vigia/servicio` → `enviar` → `redactor` → `agents/analista`, cuya línea 35
 * es `import './chat-tools'` — un import de puro efecto que registra las 12
 * tools de lectura del PANEL. Medido: el agente del chofer alcanzaba
 * `viajes_flota` (nombre completo de los otros operadores + anticipo de cada
 * viaje de la flota), `motor_fiscal`, `liquidaciones_flota` y `top_rutas`,
 * todas del área `dinero` que un jefe de tráfico del propio panel no puede ver.
 *
 * El repo ya tenía la forma escrita: `conPermisos`
 * (`orquestador/herramientas.ts`) envuelve al analista «para que una tool
 * registrada para otro agente, una inventada, una de otra área, se rechace SIN
 * ejecutarse». Faltaba el equivalente del ciclo del cuadre, donde el criterio
 * no es el rol sino el catálogo declarado del agente.
 *
 * Falla CERRADO y se DERIVA de `config.tools`: agregar una tool al agente la
 * habilita sin tocar esto; quitarla la cierra. No hay segunda lista que
 * mantener sincronizada.
 */
export function soloOfrecidas(
  ofrecidas: readonly string[],
  base: ToolExecutor,
  agente: string,
): ToolExecutor {
  const permitidas = new Set(ofrecidas);
  return async (name, args, signal) => {
    if (!permitidas.has(name)) {
      // `error` y no `warn`: que el modelo pida una tool que no se le ofreció
      // es, en el camino del chofer, la firma de una inyección por WhatsApp.
      logger.error('tool.fuera_del_catalogo', { agente, herramienta: name, ofrecidas: ofrecidas.length });
      return {
        success: true,
        result: {
          error: 'fuera_del_catalogo',
          mensaje: `La herramienta "${name}" no es parte de este agente y no se ejecutó. No inventes ni deduzcas su resultado: contesta con lo que sí puedes consultar.`,
          herramienta: name,
        },
        durationMs: 0,
      };
    }
    return base(name, args, signal);
  };
}

export interface RunAgentResult {
  finalText: string;
  toolCalls: ToolCallRecord[];
  model: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  /**
   * Pass-through de `generateWithTools`: costo partido por modelo real de cada
   * ronda. `model`/`costUsd` arriba siguen siendo el resumen de una fila; esto
   * es lo que le permite a `processor.ts` registrar una fila de `llm_costo` POR
   * MODELO cuando el ciclo cruzó de proveedor a medio camino (auditoría 10,
   * MEDIO reincidente).
   */
  costoPorModelo: Record<string, { tokensIn: number; tokensOut: number; cost: number }>;
}

/** Techo de salida POR RONDA del ciclo de cuadre (tokens). Default 4,000. */
export function maxTokensCuadre(): number {
  const v = Number(process.env.LIKIDA_CUADRE_MAX_TOKENS);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 4000;
}

/** Rondas de tools por turno del cuadre. Default 6. */
export function maxRondasCuadre(): number {
  const v = Number(process.env.LIKIDA_CUADRE_MAX_RONDAS);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 6;
}

export function timeoutAgenteMs(): number {
  const v = Number(process.env.LIKIDA_AGENT_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 40_000;
}

export async function runAgent(opts: {
  agent: AgentName;
  tenant: TenantContext;
  ctx: ToolContext;
  history: OpenAI.Chat.ChatCompletionMessageParam[];
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<RunAgentResult> {
  const config = AGENT_REGISTRY[opts.agent];
  const system = getSystemPrompt(config.systemPromptKey, opts.tenant);
  const tools = toolSchemas(config.tools);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), opts.timeoutMs ?? timeoutAgenteMs());
  const signal = combineAbortSignals(opts.signal, opts.ctx.signal, controller.signal)!;
  const runId = opts.ctx.runId ?? randomUUID();
  const budget = createLlmBudget(opts.ctx.tenantId, runId, 'interactivo');
  const ctx: ToolContext = { ...opts.ctx, runId, signal };

  // ME-1: aplicar los parámetros por rol (temp 0 + reasoning donde importa), en
  // vez del default mudo de 0.3. El cuadre orquesta dinero → determinístico.
  const params = ROLE_PARAMS[config.role];
  try {
    const res = await generateWithTools({
      role: config.role,
      system,
      messages: opts.history,
      tools,
      toolExecutor: soloOfrecidas(config.tools, makeExecutor(ctx), config.name),
      temperature: params.temperature,
      reasoning: params.reasoning,
      signal,
      budget,
      // M21 (auditoría 18): el techo del cuadre era el default mudo de
      // openrouter.ts (4,000 × 6 rondas) y ningún lugar lo declaraba — el rol
      // más caro del repo era el único ciclo sin techo propio. Se declara
      // aquí, con override por env para que cambiarlo cueste una variable y
      // no un despliegue (misma regla que los modelos). NO se baja a 900 como
      // en los chats: con `reasoning: 'high'` el razonamiento y la respuesta
      // comparten este presupuesto (ver DEFAULT_MAX_TOKENS).
      maxTokens: maxTokensCuadre(),
      maxToolRounds: maxRondasCuadre(),
    });
    return {
      finalText: res.finalText,
      toolCalls: res.toolCalls,
      model: res.model,
      costUsd: res.cost,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costoPorModelo: res.costoPorModelo,
    };
  } finally {
    clearTimeout(timer);
  }
}
