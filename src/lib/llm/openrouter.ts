// ═══════════════════════════════════════════════════════════════════════════
// MOTOR LLM de Cuadra — gateway model-agnostic sobre OpenRouter.
//
// Adaptado del chasis de atiende.ai, con mejoras para Cuadra:
//   + Visión nativa en generateStructured (OCR de comprobantes → JSON tipado).
//   + Ruteo por rol desde ./models (no reglas médicas hardcodeadas).
//   + Fallback cross-provider automático en errores transient.
//   + Loop-guard + dedup + PartialExecutionError en el ciclo de tools
//     (para que un fallback NUNCA re-ejecute una mutación = no duplica liquidaciones).
// ═══════════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { modelFor, type ModelRole } from './models';

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY no configurada');
  _client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: key,
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://cuadra.mx',
      'X-Title': 'Cuadra',
    },
  });
  return _client;
}

/**
 * Tope de salida por defecto para respuestas estructuradas.
 *
 * Estaba en 1200 y truncaba comprobantes REALES: Gemini Flash gasta 1,000–1,800
 * tokens de razonamiento invisible antes de escribir la primera llave, así que
 * el JSON (≈100 tokens) se cortaba a media línea y el ticket se reportaba como
 * "foto ilegible". Medido con 5 tickets de campo (27-jul-2026): 3 de 5 cortados
 * con `finish_reason: 'length'`; los 5 pasan con holgura arriba de 2,000.
 *
 * `max_tokens` es un TECHO, no un cargo: subirlo no cuesta nada si el modelo no
 * lo usa. Se paga lo generado.
 */
const DEFAULT_MAX_TOKENS = 4000;

// Fallback cross-provider por modelo. El primario cae a un proveedor distinto
// para que un provider caído nunca sea un error visible para el operador.
const FALLBACK: Record<string, string> = {
  'google/gemini-3.6-flash': 'anthropic/claude-haiku-4.5',
  'google/gemini-3.5-flash-lite': 'openai/gpt-5.6-luna',
  'anthropic/claude-sonnet-5': 'openai/gpt-5.6-terra',
  'anthropic/claude-opus-5': 'anthropic/claude-sonnet-5',
};

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    /\b(5\d\d|429|408|502|503|504)\b/.test(msg) ||
    /timeout|timed out|fetch failed|network|econnreset|enotfound|rate.?limit|overloaded|capacity/i.test(msg)
  );
}

// Precios [in, out] por 1M tokens — safety net; ver models.ts para el stack.
const PRICES: Record<string, [number, number]> = {
  'google/gemini-3.6-flash': [1.5, 7.5],
  'google/gemini-3.5-flash-lite': [0.3, 2.5],
  'anthropic/claude-sonnet-5': [2, 10],       // intro VIGENTE hasta 31-ago-2026; revertir a [3,15] después
  'anthropic/claude-opus-5': [5, 25],
  'anthropic/claude-haiku-4.5': [1, 5],
  'openai/gpt-5.6-terra': [2.5, 15],
  'openai/gpt-5.6-luna': [1, 6],
};

/**
 * Costo en USD de una llamada.
 *
 * Un modelo sin precio NO cuesta $0. Antes devolvía 0 en silencio, y eso pasa de
 * verdad: OpenRouter a veces devuelve el slug con sufijo de proveedor
 * (`:nitro`, `:floor`), y sobre todo pasa cada vez que alguien cambia de modelo
 * y no toca la tabla. El resultado era una liquidación que parecía gratis.
 *
 * Para un negocio que va a cobrar POR LIQUIDACIÓN, un costo que se subestima en
 * silencio es peor que uno que se equivoca ruidosamente: nadie mira lo que
 * parece correcto.
 */
export function calcCost(model: string, tokIn: number, tokOut: number): number {
  // El sufijo de proveedor no cambia el precio del modelo.
  const limpio = model.split(':')[0];
  const r = PRICES[model] ?? PRICES[limpio];
  if (r) return (tokIn * r[0] + tokOut * r[1]) / 1_000_000;

  // Desconocido: se estima con la tarifa MÁS CARA de la tabla y se avisa. Que
  // salga alto es justo lo que hace que alguien lo mire.
  const caro = Object.values(PRICES).reduce(
    (max, p) => [Math.max(max[0], p[0]), Math.max(max[1], p[1])] as [number, number],
    [0, 0] as [number, number],
  );
  logger.warn('llm.modelo_sin_precio', { model, estimadoCon: 'tarifa más cara de la tabla' });
  return (tokIn * caro[0] + tokOut * caro[1]) / 1_000_000;
}

// OpenRouter: no retener input (compliance de datos fiscales).
const PROVIDER_OPTS = { provider: { data_collection: 'deny' } } as const;

// ── generateResponse: chat simple con fallback ──────────────────────────────
export async function generateResponse(opts: {
  role: ModelRole;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}) {
  const model = modelFor(opts.role);
  const fallback = FALLBACK[model] ?? null;

  const once = async (m: string) => {
    const res = await getClient().chat.completions.create({
      model: m,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
      max_tokens: opts.maxTokens ?? 500,
      temperature: opts.temperature ?? 0.4,
      ...PROVIDER_OPTS,
    });
    const text = (res.choices[0]?.message?.content ?? '').trim();
    return {
      text,
      model: res.model || m,
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      cost: calcCost(m, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0),
    };
  };

  try {
    return await once(model);
  } catch (err) {
    if (!fallback || !isTransientError(err)) throw err;
    logger.warn('llm.fallback', { from: model, to: fallback });
    return await once(fallback);
  }
}

// Extrae el objeto JSON de una respuesta: quita fences markdown (```json) y
// recorta prosa alrededor, tolerando modelos que no respetan response_format.
function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return s;
}

// ── generateStructured: JSON garantizado por schema, con VISIÓN opcional ─────
export class StructuredError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
    public raw?: string,
    /** Consumo de la llamada que falló: se cobra igual, hay que contabilizarlo. */
    public usage?: { model: string; tokensIn: number; tokensOut: number; cost: number },
  ) {
    super(message);
    this.name = 'StructuredError';
  }
}

/**
 * La respuesta se CORTÓ por presupuesto (`finish_reason: 'length'`), no vino
 * malformada. Distinguirlo importa: un JSON truncado no se arregla pidiéndole
 * al modelo que "responda solo JSON" (ya lo hacía), ni es culpa de la imagen.
 * Los modelos con razonamiento gastan cientos de tokens invisibles antes de
 * escribir la primera llave, así que el tope se agota sin producir salida.
 */
export class TruncatedError extends StructuredError {
  constructor(
    message: string,
    public tokensUsados: number,
    public tope: number,
    raw?: string,
    usage?: { model: string; tokensIn: number; tokensOut: number; cost: number },
  ) {
    super(message, undefined, raw, usage);
    this.name = 'TruncatedError';
  }
}

export async function generateStructured<T>(opts: {
  role: ModelRole;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: z.ZodType<T>;
  schemaName: string;
  /**
   * Corta la llamada cuando el presupuesto de la invocación se acaba.
   *
   * Sin esto se cae al default del SDK de OpenAI —10 minutos—, y el webhook solo
   * tiene 60s: una foto lenta se lleva por delante la invocación entera,
   * incluido el "listo" que sí venía bien medido. Y como Meta ya recibió su 200,
   * no reintenta: el mensaje se pierde en silencio.
   */
  signal?: AbortSignal;
  /** Data-URLs de imágenes (OCR de comprobantes). Se adjuntan al último mensaje user. */
  images?: string[];
  maxTokens?: number;
  temperature?: number;
}): Promise<{ data: T; raw: string; model: string; tokensIn: number; tokensOut: number; cost: number }> {
  const model = modelFor(opts.role);
  const fallback = FALLBACK[model] ?? null;
  const jsonSchema = z.toJSONSchema(opts.schema, { target: 'draft-7' }) as Record<string, unknown>;

  // OpenRouter/OpenAI json_schema exige additionalProperties:false en cada objeto.
  const strictify = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.type === 'object' && o.additionalProperties === undefined) o.additionalProperties = false;
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(strictify);
      else if (typeof v === 'object') strictify(v);
    }
  };
  strictify(jsonSchema);

  // Construir mensajes; si hay imágenes, el último user lleva content multimodal.
  const built: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  if (opts.images?.length) {
    const lastUserIdx = [...built].map((m) => m.role).lastIndexOf('user');
    const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: typeof built[lastUserIdx]?.content === 'string' ? (built[lastUserIdx].content as string) : 'Extrae los datos de estas imágenes.' },
      ...opts.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ];
    if (lastUserIdx >= 0) built[lastUserIdx] = { role: 'user', content: parts };
    else built.push({ role: 'user', content: parts });
  }

  // OpenRouter cobra la llamada aunque el JSON venga truncado o no valide. El
  // `usage` ya viajaba dentro del error para eso, pero cuando el reintento salía
  // bien ese error se descartaba y su consumo con él: se reportaba UN intento
  // habiendo pagado dos, tres o cuatro. Likida va a cobrar por liquidación, así
  // que un costo unitario subestimado se propaga directo al precio.
  const gastado = { tokensIn: 0, tokensOut: 0, cost: 0 };
  const cobrar = (u: { tokensIn: number; tokensOut: number; cost: number }) => {
    gastado.tokensIn += u.tokensIn;
    gastado.tokensOut += u.tokensOut;
    gastado.cost += u.cost;
  };

  const attempt = async (m: string, note?: string, tope?: number): Promise<{ data: T; raw: string; model: string; tokensIn: number; tokensOut: number; cost: number }> => {
    // Si el presupuesto ya se agotó, no se paga una llamada que se va a cortar a
    // media respuesta.
    opts.signal?.throwIfAborted();
    const msgs = note
      ? [{ role: 'system' as const, content: `${opts.system}\n\n${note}` }, ...built.slice(1)]
      : built;
    const maxTokens = tope ?? opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    // Si el presupuesto ya se agotó, no se paga una llamada que se va a cortar a
    // media respuesta.
    opts.signal?.throwIfAborted();
    const res = await getClient().chat.completions.create({
      model: m,
      messages: msgs,
      max_tokens: maxTokens,
      temperature: opts.temperature ?? 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: opts.schemaName, strict: true, schema: jsonSchema },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      ...PROVIDER_OPTS,
    }, opts.signal ? { signal: opts.signal } : undefined);
    const raw = res.choices[0]?.message?.content || '';
    // La llamada se cobra aunque falle: el consumo viaja EN el error para que el
    // contador por liquidación no reporte $0 en los intentos fallidos.
    const tokIn = res.usage?.prompt_tokens ?? 0;
    const tokOut = res.usage?.completion_tokens ?? 0;
    const usage = { model: res.model || m, tokensIn: tokIn, tokensOut: tokOut, cost: calcCost(m, tokIn, tokOut) };
    // Se cobra AQUÍ, antes de cualquier salida: pase lo que pase debajo —
    // truncado, JSON roto, schema inválido— esta llamada ya se pagó.
    cobrar(usage);

    // Se cortó por presupuesto: NO es JSON malformado ni una foto mala. Se
    // detecta ANTES de parsear, porque el parseo también falla y confunde el
    // diagnóstico (era el bug: truncamiento disfrazado de "ilegible").
    if (res.choices[0]?.finish_reason === 'length') {
      throw new TruncatedError(
        `Respuesta truncada: se agotaron los ${maxTokens} tokens de salida (usó ${tokOut}) antes de cerrar el JSON`,
        tokOut,
        maxTokens,
        raw,
        usage,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (e) {
      throw new StructuredError('JSON parse falló', e, raw, usage);
    }
    const v = opts.schema.safeParse(parsed);
    if (!v.success) throw new StructuredError(`Validación falló: ${v.error.message}`, v.error, raw, usage);
    // Se devuelve el ACUMULADO del turno, no el de este intento: el llamador
    // quiere saber qué costó extraer este comprobante, no qué costó el último
    // reintento.
    return { data: v.data, raw, model: usage.model, ...gastado };
  };

  /**
   * Deja el consumo ACUMULADO del turno en el error que sale a la superficie.
   * Sin esto el llamador solo veía el del último intento y descontaba de menos
   * justo en el caso más caro: el que falló varias veces antes de rendirse.
   */
  const conGastado = (e: unknown, msg: string): StructuredError => {
    const err = e instanceof StructuredError ? e : new StructuredError(msg, e);
    err.usage = { model, ...gastado };
    return err;
  };

  const note = 'IMPORTANTE: responde EXCLUSIVAMENTE con JSON válido que cumpla el schema, sin markdown ni texto extra.';
  const tope = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  try {
    return await attempt(model);
  } catch (e1) {
    // Truncamiento: reintentar con la nota NO sirve — el modelo ya estaba
    // respondiendo JSON, se quedó sin presupuesto a media escritura. Lo único
    // que falta es techo, así que el reintento sube el tope en vez de regañarlo.
    if (e1 instanceof TruncatedError) {
      logger.warn('llm.truncado', { fn: 'generateStructured', model, tope: e1.tope, usados: e1.tokensUsados, reintentoCon: tope * 2 });
      try {
        return await attempt(model, undefined, tope * 2);
      } catch (eT) {
        // Si el doble tampoco alcanza, el problema es real: no lo disfraces
        // pasándolo por la escalera de "formato malo". Se relanza tal cual para
        // conservar el diagnóstico, pero con el consumo de AMBOS intentos: el
        // error trae el suyo, y el del primero se perdía.
        if (eT instanceof TruncatedError) { eT.usage = { model, ...gastado }; throw eT; }
      }
    }
    // Reintento con el MISMO modelo + nota (típicamente errores de formato JSON).
    try {
      return await attempt(model, note);
    } catch (e2) {
      // CR-5: si el fallo es transient (provider caído/429/timeout) y hay
      // fallback cross-provider, intentar con OTRO proveedor antes de rendirse.
      if (fallback && (isTransientError(e1) || isTransientError(e2))) {
        logger.warn('llm.fallback', { fn: 'generateStructured', from: model, to: fallback });
        try {
          return await attempt(fallback, note);
        } catch (e3) {
          throw conGastado(e3, 'Falló generación estructurada (fallback)');
        }
      }
      throw conGastado(e2, 'Falló generación estructurada');
    }
  }
}

// ── generateWithTools: ciclo agéntico completo ──────────────────────────────
export type ToolExecResult = { success: boolean; result: unknown; error?: string; durationMs: number };
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<ToolExecResult>;
export type ToolCallRecord = { toolName: string; args: Record<string, unknown>; result: unknown; durationMs: number; error?: string };

export class LoopGuardError extends Error {
  constructor(public rounds: number) {
    super(`Ciclo de tools excedió ${rounds} rondas`);
    this.name = 'LoopGuardError';
  }
}

export class PartialExecutionError extends Error {
  constructor(
    message: string,
    public cause: unknown,
    public partialToolCalls: ToolCallRecord[],
    /**
     * Lo que YA se pagó en las rondas que sí corrieron.
     *
     * Antes no viajaba, y el processor —en su rama de recuperación de cierre
     * parcial, con el flag activo por default— tampoco llamaba `registrarCosto`.
     * La liquidación salía con su PDF y lo gastado en OpenRouter para producirla
     * quedaba invisible. En un negocio que cobra POR LIQUIDACIÓN, el costo
     * unitario se subestima justo en el caso que más consume.
     */
    public tokensIn = 0,
    public tokensOut = 0,
    public cost = 0,
  ) {
    super(message);
    this.name = 'PartialExecutionError';
  }
}

const READ_PREFIXES = ['get_', 'check_', 'list_', 'find_', 'consultar_', 'validar_'];
const isReadOnly = (n: string) => READ_PREFIXES.some((p) => n.startsWith(p));

export async function generateWithTools(opts: {
  role: ModelRole;
  system: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.ChatCompletionTool[];
  toolExecutor: ToolExecutor;
  maxToolRounds?: number;
  maxTokens?: number;
  temperature?: number;
  /** Esfuerzo de razonamiento (OpenRouter unified reasoning). Si se pasa, se
   *  omite temperature (los modelos de razonamiento la ignoran/rechazan). */
  reasoning?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}): Promise<{ finalText: string; toolCalls: ToolCallRecord[]; model: string; tokensIn: number; tokensOut: number; cost: number }> {
  const model = modelFor(opts.role);
  const fallback = FALLBACK[model] ?? null;
  const maxRounds = opts.maxToolRounds ?? 6;
  const client = getClient();
  const executed: ToolCallRecord[] = [];
  let tokIn = 0, tokOut = 0, used = model;
  // B23: el costo se acumula POR RONDA, con el modelo que de verdad respondió
  // esa ronda. Acumulando solo tokens y precificando una vez al final, un ciclo
  // que corre tres rondas en el primario y cae al fallback en la cuarta cobraba
  // las cuatro al precio del fallback.
  let costo = 0;
  let activeModel = model; // cambia a fallback si el primario cae (persiste el resto del ciclo)

  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    ...opts.messages,
  ];
  const crossRound = new Map<string, ToolExecResult>();

  // CR-5: completado con fallback cross-provider. Reintentar SÓLO la llamada de
  // completado (las tools se ejecutan DESPUÉS, en nuestro código) es seguro: una
  // caída del provider nunca re-ejecuta una mutación ni duplica una liquidación.
  const complete = async (msgs: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    const body = () => ({
      model: activeModel,
      messages: msgs,
      tools: opts.tools.length ? opts.tools : undefined,
      tool_choice: opts.tools.length ? ('auto' as const) : undefined,
      max_tokens: opts.maxTokens ?? 1000,
      // reasoning y temperature son mutuamente excluyentes; van por spread para
      // no chocar con el tipado del SDK (igual que PROVIDER_OPTS).
      ...(opts.reasoning ? { reasoning: { effort: opts.reasoning } } : { temperature: opts.temperature ?? 0.3 }),
      ...PROVIDER_OPTS,
    });
    const signalOpt = opts.signal ? { signal: opts.signal } : undefined;
    try {
      return await client.chat.completions.create(body(), signalOpt);
    } catch (err) {
      if (fallback && activeModel === model && isTransientError(err)) {
        logger.warn('llm.fallback', { fn: 'generateWithTools', from: model, to: fallback });
        activeModel = fallback;
        return await client.chat.completions.create(body(), signalOpt);
      }
      throw err;
    }
  };

  try {
    for (let round = 0; round < maxRounds; round++) {
      const res = await complete(convo);
      const rIn = res.usage?.prompt_tokens ?? 0;
      const rOut = res.usage?.completion_tokens ?? 0;
      tokIn += rIn;
      tokOut += rOut;
      // `activeModel` ya refleja quién respondió ESTA ronda: `complete` lo mueve
      // al fallback antes de devolver.
      costo += calcCost(activeModel, rIn, rOut);
      used = res.model || activeModel;
      const choice = res.choices[0];
      const calls = choice?.message?.tool_calls;

      if (!calls || calls.length === 0) {
        // El costo ya viene sumado ronda a ronda, cada una al precio del modelo
        // que la respondió. (Antes se precificaba aquí, de una vez, con el
        // modelo activo al final: correcto solo si el ciclo entero corrió en el
        // mismo modelo.)
        return { finalText: choice?.message?.content ?? '', toolCalls: executed, model: used, tokensIn: tokIn, tokensOut: tokOut, cost: costo };
      }

      convo.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: calls });
      const inRound = new Map<string, Promise<ToolExecResult>>();

      const results = await Promise.all(
        calls.map(async (call) => {
          if (call.type !== 'function') {
            return { role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify({ error: 'tipo de tool no soportado' }) };
          }
          let args: Record<string, unknown> = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            executed.push({ toolName: call.function.name, args: {}, result: null, durationMs: 0, error: 'args_parse' });
            return { role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify({ error: 'argumentos JSON inválidos' }) };
          }
          const key = `${call.function.name}:${JSON.stringify(args)}`;
          if (isReadOnly(call.function.name) && crossRound.has(key)) {
            const c = crossRound.get(key)!;
            executed.push({ toolName: call.function.name, args, result: c.result, durationMs: c.durationMs, error: c.error });
            return { role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify(c.success ? c.result : { error: c.error }) };
          }
          let p = inRound.get(key);
          if (!p) { p = opts.toolExecutor(call.function.name, args); inRound.set(key, p); }
          const exec = await p;
          if (isReadOnly(call.function.name)) crossRound.set(key, exec);
          executed.push({ toolName: call.function.name, args, result: exec.result, durationMs: exec.durationMs, error: exec.error });
          return { role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify(exec.success ? exec.result : { error: exec.error }) };
        }),
      );
      convo.push(...results);
    }
    throw new LoopGuardError(maxRounds);
  } catch (err) {
    if (err instanceof PartialExecutionError) throw err;
    throw new PartialExecutionError(err instanceof Error ? err.message : String(err), err, executed, tokIn, tokOut, costo);
  }
}
