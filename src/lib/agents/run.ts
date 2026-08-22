// Runner: corre un agente = carga su config + tools + prompt y ejecuta el
// ciclo de tool-calling con el contexto del tenant/operador.

import type OpenAI from 'openai';
import { generateWithTools, type ToolCallRecord } from '@/lib/llm/openrouter';
import { ROLE_PARAMS } from '@/lib/llm/models';
import { toolSchemas, makeExecutor, type ToolContext } from '@/lib/llm/tool-executor';
import { AGENT_REGISTRY } from './registry';
import { getSystemPrompt } from './prompts';
import type { AgentName, TenantContext } from './types';

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

export async function runAgent(opts: {
  agent: AgentName;
  tenant: TenantContext;
  ctx: ToolContext;
  history: OpenAI.Chat.ChatCompletionMessageParam[];
  timeoutMs?: number;
}): Promise<RunAgentResult> {
  const config = AGENT_REGISTRY[opts.agent];
  const system = getSystemPrompt(config.systemPromptKey, opts.tenant);
  const tools = toolSchemas(config.tools);

  const controller = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
  const ctx: ToolContext = { ...opts.ctx, signal: controller.signal };

  // ME-1: aplicar los parámetros por rol (temp 0 + reasoning donde importa), en
  // vez del default mudo de 0.3. El cuadre orquesta dinero → determinístico.
  const params = ROLE_PARAMS[config.role];
  try {
    const res = await generateWithTools({
      role: config.role,
      system,
      messages: opts.history,
      tools,
      toolExecutor: makeExecutor(ctx),
      temperature: params.temperature,
      reasoning: params.reasoning,
      signal: controller.signal,
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
    if (timer) clearTimeout(timer);
  }
}
