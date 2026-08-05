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
