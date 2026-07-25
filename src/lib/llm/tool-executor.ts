// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE TOOLS — cada tool se registra al importarse (registerTool).
// executeTool mide tiempo, captura excepciones (nunca tumba el loop) y aplica
// scoping por tenant vía ToolContext. Las mutaciones llevan idempotencia.
// ═══════════════════════════════════════════════════════════════════════════

import type OpenAI from 'openai';
import { logger } from '@/lib/logger';
import type { ToolExecResult } from './openrouter';

/** Contexto inyectado a cada handler: IDs scoped para no pedírselos al LLM. */
export interface ToolContext {
  tenantId: string;
  operadorId?: string;
  viajeId?: string;
  conversationId?: string;
  telefono?: string;
  signal?: AbortSignal;
}

export interface RegisteredTool {
  schema: OpenAI.Chat.ChatCompletionTool;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  isMutation?: boolean;
}

const REGISTRY = new Map<string, RegisteredTool>();

export function registerTool(name: string, tool: RegisteredTool): void {
  if (REGISTRY.has(name)) logger.warn('tool.reregister', { name });
  REGISTRY.set(name, tool);
}

/** Devuelve los schemas (ChatCompletionTool) para los nombres dados. */
export function toolSchemas(names: string[]): OpenAI.Chat.ChatCompletionTool[] {
  return names
    .map((n) => REGISTRY.get(n)?.schema)
    .filter((s): s is OpenAI.Chat.ChatCompletionTool => Boolean(s));
}

/** Ejecuta una tool por nombre con timing + captura de errores. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecResult> {
  const started = Date.now();
  const tool = REGISTRY.get(name);
  if (!tool) {
    return { success: false, result: null, error: `tool desconocida: ${name}`, durationMs: 0 };
  }
  try {
    const result = await tool.handler(args, ctx);
    return { success: true, result, durationMs: Date.now() - started };
  } catch (err) {
    logger.error('tool.error', { name, err: err instanceof Error ? err.message : String(err) });
    return {
      success: false,
      result: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Fabrica un ToolExecutor cerrado sobre un ToolContext (para generateWithTools).
 * IDEMPOTENCIA DE MUTACIONES: una tool marcada `isMutation` no se re-ejecuta si el
 * agente la llama otra vez en el MISMO run — se devuelve el resultado cacheado.
 * Evita, p. ej., un doble guardar_liquidacion (doble PDF/costo). Solo se cachea el
 * éxito (un fallo sí puede reintentarse). El backstop de dinero sigue siendo la
 * DB (unique(viaje_id) + upsert).
 */
export function makeExecutor(ctx: ToolContext) {
  const mutacionesHechas = new Map<string, ToolExecResult>();
  return async (name: string, args: Record<string, unknown>): Promise<ToolExecResult> => {
    if (REGISTRY.get(name)?.isMutation) {
      const key = `${name}:${JSON.stringify(args)}`;
      const cache = mutacionesHechas.get(key);
      if (cache) { logger.warn('tool.mutation_dedup', { name }); return cache; }
      const res = await executeTool(name, args, ctx);
      if (res.success) mutacionesHechas.set(key, res);
      return res;
    }
    return executeTool(name, args, ctx);
  };
}
