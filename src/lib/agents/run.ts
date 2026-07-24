// Runner: corre un agente = carga su config + tools + prompt y ejecuta el
// ciclo de tool-calling con el contexto del tenant/operador.

import type OpenAI from 'openai';
import { generateWithTools, type ToolCallRecord } from '@/lib/llm/openrouter';
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

  try {
    const res = await generateWithTools({
      role: config.role,
      system,
      messages: opts.history,
      tools,
      toolExecutor: makeExecutor(ctx),
      signal: controller.signal,
    });
    return {
      finalText: res.finalText,
      toolCalls: res.toolCalls,
      model: res.model,
      costUsd: res.cost,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
