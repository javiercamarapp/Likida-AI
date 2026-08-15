// ═══════════════════════════════════════════════════════════════════════════
// LLAMADA — una sola invocación a OpenRouter con modelo ARBITRARIO.
//
// Reusa el motor de Likida (getClient + costoReal) sin pasar por el router
// por rol de producción: aquí el modelo lo decide la auditoría por RUBRO y
// por FIXER. Reglas que se mantienen del motor:
//   · ZDR: data_collection:'deny' (soberanía fiscal LFPDPPP).
//   · usage.include → costo REAL del proveedor (con caché), no tabla.
//   · Fallback: un reintento a Gemini (US) solo si el error es transitorio.
//   · Cada llamada se registra en el ledger con su costo real.
// ═══════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { getClient, costoReal, isTransientError } from '@/lib/llm/openrouter';
import { registrarUso } from './ledger.audit';
import { rondaActual, cargaEnvLocal } from './config.audit';
import { TOOLS_DEF, ejecutarTool } from './tools.audit';

cargaEnvLocal();

export interface Llamada {
  text: string;
  modelo: string;
  tokIn: number;
  tokOut: number;
  cost: number;
}

/**
 * ZDR por llamada. El PRO 0813 solo lo sirve DeepSeek (CN) y NO tiene
 * endpoint con data_collection:deny (404). Si se pide explícitamente
 * (AUDIT_DEEPSEEK_PRO=1), se le quita la política a ese modelo — es
 * material de decisión de política, no un bug.
 */
const PROVIDER_AUDIT = {
  provider: { data_collection: 'deny' },
  usage: { include: true },
} as const;

export interface LlamadaOpts {
  modelo: string;
  system?: string;
  mensajes: { role: 'system' | 'user' | 'assistant'; content: string }[];
  quien: string;
  maxTokens?: number;
  temperatura?: number;
}

async function onceSola(opts: LlamadaOpts, modelo: string): Promise<Llamada> {
  const n = rondaActual();
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    ...opts.mensajes.map((m) => ({ role: m.role, content: m.content })),
  ];
  const res = await getClient().chat.completions.create({
    model: modelo,
    messages: msgs,
    max_tokens: opts.maxTokens ?? 6000,
    temperature: opts.temperatura ?? 0.3,
    ...(modelo.includes('deepseek') ? { usage: { include: true }, reasoning: { effort: 'high' } } : PROVIDER_AUDIT),
  });
  const usage = res.usage;
  const tokIn = usage?.prompt_tokens ?? 0;
  const tokOut = usage?.completion_tokens ?? 0;
  const cost = costoReal(usage as { cost?: number } | undefined, modelo, tokIn, tokOut);
  registrarUso(n, opts.quien, modelo, tokIn, tokOut, cost);
  return { text: (res.choices[0]?.message?.content ?? '').trim(), modelo: res.model ?? modelo, tokIn, tokOut, cost };
}

/** Ejecuta la llamada; si el proveedor falla de forma transitoria, cae a Gemini (US). */
export async function llamada(opts: LlamadaOpts): Promise<Llamada> {
  try {
    return await onceSola(opts, opts.modelo);
  } catch (err) {
    if (opts.modelo === 'google/gemini-3.7-flash') throw err;
    const transitorio = isTransientError(err);
    if (!transitorio) throw err;
    process.stderr.write(`[audit] fallback transitorio: ${opts.modelo} → gemini-flash (${String((err as Error).message ?? '').slice(0, 80)})\n`);
    return await onceSola(opts, 'google/gemini-3.7-flash');
  }
}

export interface LlamadaTools extends LlamadaOpts {
  pasosMax?: number;
}

/**
 * Tool-loop para auditores: puede llamar leer/buscar/listar hasta pasosMax
 * vueltas y luego responde. Cada tool-call se cobra y va al ledger.
 */
export async function llamadaConTools(opts: LlamadaTools): Promise<Llamada> {
  const n = rondaActual();
  const maxPasos = Math.min(opts.pasosMax ?? 8, 12);
  const mensajes: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    ...opts.mensajes.map((m) => ({ role: m.role, content: m.content })),
  ];
  let modeloUsado = opts.modelo;
  let gasto = 0;
  for (let paso = 0; paso <= maxPasos; paso++) {
    const res = await getClient().chat.completions.create({
      model: opts.modelo,
      messages: mensajes,
      max_tokens: opts.maxTokens ?? 12000,
      temperature: opts.temperatura ?? 0.3,
      tools: TOOLS_DEF as unknown as OpenAI.Chat.ChatCompletionTool[],
      tool_choice: 'auto',
      ...(opts.modelo.includes('deepseek') ? { usage: { include: true }, reasoning: { effort: 'high' } } : PROVIDER_AUDIT),
    });
    const msg = res.choices[0]?.message;
    const texto = (msg?.content ?? '').trim();
    const uso = res.usage;
    const tokIn = uso?.prompt_tokens ?? 0;
    const tokOut = uso?.completion_tokens ?? 0;
    const cost = costoReal(uso as { cost?: number } | undefined, modeloUsado, tokIn, tokOut);
    gasto += cost;
    registrarUso(n, opts.quien, modeloUsado, tokIn, tokOut, cost);
    if (msg?.tool_calls?.length) {
      const tcs = msg.tool_calls as unknown as Array<{
        id?: string | null;
        function?: { name?: string | null; arguments?: string | null } | null;
      }>;
      mensajes.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: tcs.map((tc) => ({
          id: tc.id ?? '',
          type: 'function' as const,
          function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
        })),
      });
      for (const tc of tcs) {
        const nombre = tc.function?.name ?? '';
        const args = tc.function?.arguments ?? '{}';
        const result = ejecutarTool(nombre, args);
        mensajes.push({ role: 'tool', tool_call_id: tc.id ?? '', content: result.slice(0, 12000) });
        process.stderr.write(`[audit][${opts.quien}] 🧰 ${nombre}(${String(args).slice(0, 60)}) → ${result.length} chars\n`);
      }
      continue;
    }
    return { text: texto, modelo: res.model ?? modeloUsado, tokIn, tokOut, cost: gasto };
  }
  return { text: '(sin respuesta final tras agotar pasos de herramienta)', modelo: modeloUsado, tokIn: 0, tokOut: 0, cost: gasto };
}