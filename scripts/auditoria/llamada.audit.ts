// ═══════════════════════════════════════════════════════════════════════════
// LLAMADA — invocaciones a OpenRouter con modelo ARBITRARIO (auditoría).
//
// Reusa el motor de Likida (getClient + costoReal) sin pasar por el router por
// rol de producción: aquí el modelo lo decide la auditoría por RUBRO y por
// FIXER. Reglas que se mantienen:
//   · ZDR: data_collection:'deny' (soberanía fiscal LFPDPPP) — salvo el PRO
//     0813 (su único proveedor no lo ofrece; política explícita).
//   · usage.include → costo REAL del proveedor (con caché), no tabla.
//   · Fallback transitorio: reintento del mismo modelo y, si sigue cayendo,
//     cambio a Gemini (US). Un "Connection error." puntual NO tumba la ronda
//     (lección aud-13).
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
  tools?: number;
}

const ZDR = {
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

const GEMINI_BACKUP = 'google/gemini-3.7-flash';

function extraOpts(modelo: string): Record<string, unknown> {
  return modelo.includes('deepseek')
    ? { usage: { include: true }, reasoning: { effort: 'high' } }
    : ZDR;
}

async function crearConReintento(
  modelo: string,
  msgs: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens: number,
  temperatura: number,
  extra: Record<string, unknown>,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let ultimo: unknown = null;
  for (let i = 0; i < 2; i++) {
    try {
      return await getClient().chat.completions.create({
        model: modelo,
        messages: msgs,
        max_tokens: maxTokens,
        temperature: temperatura,
        ...extra,
      });
    } catch (err) {
      ultimo = err;
      if (!isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw ultimo;
}

async function resolver(n: number, quien: string, modelo: string, res: OpenAI.Chat.ChatCompletion, tools = 0): Promise<Llamada> {
  const tokIn = res.usage?.prompt_tokens ?? 0;
  const tokOut = res.usage?.completion_tokens ?? 0;
  const cost = costoReal(res.usage as { cost?: number } | undefined, modelo, tokIn, tokOut);
  registrarUso(n, quien, modelo, tokIn, tokOut, cost);
  return { text: (res.choices[0]?.message?.content ?? '').trim(), modelo: res.model ?? modelo, tokIn, tokOut, cost, tools };
}

/** Chat simple con fallback transitorio a Gemini. */
export async function llamada(opts: LlamadaOpts): Promise<Llamada> {
  const n = rondaActual();
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    ...opts.mensajes.map((m) => ({ role: m.role, content: m.content })),
  ];
  const extra = extraOpts(opts.modelo);
  try {
    const res = await crearConReintento(opts.modelo, msgs, opts.maxTokens ?? 6000, opts.temperatura ?? 0.3, extra);
    return await resolver(n, opts.quien, opts.modelo, res);
  } catch (err) {
    if (opts.modelo === GEMINI_BACKUP || !isTransientError(err)) throw err;
    process.stderr.write(`[audit] fallback transitorio: ${opts.modelo} → gemini (${String((err as Error).message).slice(0, 70)})\n`);
    const res = await crearConReintento(GEMINI_BACKUP, msgs, opts.maxTokens ?? 6000, opts.temperatura ?? 0.3, ZDR);
    return await resolver(n, opts.quien, GEMINI_BACKUP, res);
  }
}

/** Tool-loop para auditores: leer/buscar/listar hasta pasosMax vueltas.
 *  Tolerante a fallos transitorios: reintenta y si cae, migra a Gemini. */
export async function llamadaConTools(opts: LlamadaOpts & { pasosMax?: number }): Promise<Llamada> {
  const n = rondaActual();
  const maxPasos = Math.min(opts.pasosMax ?? 12, 30);
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    ...opts.mensajes.map((m) => ({ role: m.role, content: m.content })),
  ];
  let modeloActivo = opts.modelo;
  let gasto = 0;
  let herramientas = 0;

  for (let paso = 0; paso <= maxPasos; paso++) {
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await crearConReintento(modeloActivo, msgs, opts.maxTokens ?? 12000, opts.temperatura ?? 0.3, {
        ...extraOpts(opts.modelo),
        tools: TOOLS_DEF as unknown as OpenAI.Chat.ChatCompletionTool[],
        tool_choice: 'auto',
      });
    } catch (err) {
      if (!isTransientError(err) || modeloActivo === GEMINI_BACKUP) throw err;
      process.stderr.write(`[audit] tool-loop: ${modeloActivo} caído → ${GEMINI_BACKUP}\n`);
      modeloActivo = GEMINI_BACKUP;
      gasto += 0;
      if (paso === maxPasos) break;
      continue;
    }
    const msg = res.choices[0]?.message;
    const texto = (msg?.content ?? '').trim();
    const costo = costoReal(res.usage as { cost?: number } | undefined, modeloActivo, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0);
    gasto += costo;
    registrarUso(n, opts.quien, modeloActivo, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0, costo);

    if (msg?.tool_calls?.length) {
      herramientas++;
      const tcs = msg.tool_calls as unknown as Array<{
        id?: string | null;
        function?: { name?: string | null; arguments?: string | null } | null;
      }>;
      msgs.push({
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
        msgs.push({ role: 'tool', tool_call_id: tc.id ?? '', content: result.slice(0, 12000) });
        process.stderr.write(`[audit][${opts.quien}] 🧰 ${nombre}(${String(args).slice(0, 60)}) → ${result.length} chars\n`);
      }
      continue;
    }
    return { text: texto, modelo: res.model ?? modeloActivo, tokIn: res.usage?.prompt_tokens ?? 0, tokOut: res.usage?.completion_tokens ?? 0, cost: gasto, tools: herramientas };
  }
  return { text: '(sin respuesta final tras agotar pasos de herramienta)', modelo: modeloActivo, tokIn: 0, tokOut: 0, cost: gasto, tools: herramientas };
}