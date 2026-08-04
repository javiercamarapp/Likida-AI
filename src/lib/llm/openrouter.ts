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
      // El fallback era `cuadra.mx`, que es un dominio PARKEADO de un tercero.
      // Aquí solo viaja en una cabecera hacia OpenRouter, así que el daño era
      // atribuirle nuestro consumo a un desconocido — pero es el mismo valor
      // equivocado que estaba impreso en el PDF.
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://likida.ai',
      'X-Title': 'Likida',
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
  // POR TIPO ANTES QUE POR TEXTO. El SDK de OpenAI aplasta CUALQUIER fallo de
  // conexión —DNS, TCP rechazado, TLS, `fetch failed` de undici— en un
  // `APIConnectionError` con el mensaje literal "Connection error."; el detalle
  // real vive en `err.cause`. Clasificar solo por el mensaje dejaba fuera justo
  // el caso para el que existe el fallback: el proveedor caído. Los 503 sí
  // pasaban, y por eso los tests no lo vieron.
  const e = err as { name?: unknown; status?: unknown; cause?: unknown } | null;
  if (e && typeof e === 'object') {
    if (typeof e.name === 'string' && /^APIConnection(Timeout)?Error$/.test(e.name)) return true;
    if (typeof e.status === 'number' && (e.status >= 500 || e.status === 429 || e.status === 408)) return true;
  }
  const texto = [err, e?.cause]
    .map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : ''))
    .join(' ')
    .toLowerCase();
  return (
    /\b(5\d\d|429|408|502|503|504)\b/.test(texto) ||
    /timeout|timed out|connection error|fetch failed|network|econnreset|enotfound|rate.?limit|overloaded|capacity/i.test(texto)
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

// ═══════════════════════════════════════════════════════════════════════════
// EL RAZONAMIENTO DEL OCR — la palanca de costo más grande, y la más peligrosa.
//
// MEDIDO el 4-ago-2026 sobre las 57 llamadas de OCR en producción: la salida
// promedia 1,536 tokens, con 51 de 57 entre 1,015 y 1,976. El JSON del schema
// son ~300. El resto son tokens de RAZONAMIENTO del modelo, que OpenRouter
// cobra como salida — y la salida cuesta varias veces más que la entrada.
//
// Que la distribución sea UNA sola joroba es lo que lo demuestra: si fueran
// reintentos (que este archivo suma en `gastado`) habría dos o tres grupos
// separados, no una campana. No los hay.
//
// Apagarlo bajaría la salida ~80% y el costo del OCR a la mitad o menos.
//
// POR QUÉ VIENE APAGADO POR DEFECTO. El razonamiento es probablemente lo que
// hace que lea un ticket térmico arrugado, con sol encima, fotografiado en una
// gasolinera. Y en ESTE producto un OCR peor no es "menor calidad": es un monto
// mal leído dentro de un documento fiscal — exactamente lo que la regla número
// uno del repo prohíbe. Un ahorro del 50% que introduce un error de captura
// cada tantos tickets sale carísimo.
//
// CÓMO SE ENCIENDE, BIEN: se mide primero contra un conjunto dorado de tickets
// reales etiquetados a mano (precisión del monto y del folio, tasa de esquema
// inválido), y solo se deja si NO pierde exactitud. Sin ese set, "se ve bien"
// no es evidencia. Existe la skill `conjunto-dorado` para armarlo.
//
// Se controla por entorno para poder probarlo sin desplegar:
//   LLM_RAZONAMIENTO_OCR=off    → sin razonamiento (barato, sin verificar)
//   LLM_RAZONAMIENTO_OCR=low    → razonamiento mínimo
//   (sin variable)              → como hoy, sin tocar nada
// ═══════════════════════════════════════════════════════════════════════════
function opcionesDeRazonamiento(role: ModelRole): Record<string, unknown> {
  if (role !== 'ocr') return {};
  const v = (process.env.LLM_RAZONAMIENTO_OCR ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'none' || v === '0') return { reasoning: { enabled: false } };
  if (v === 'low' || v === 'minimal') return { reasoning: { effort: 'low' } };
  return {};
}

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
      ...opcionesDeRazonamiento(opts.role),
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

// Prefijos de tools que SOLO LEEN, para poder cachear su resultado dentro de un
// turno. `cuadrar_` está aquí porque `cuadrar_viaje` calcula y no escribe nada —
// caía entre dos rejillas: no matcheaba ningún prefijo y tampoco es `isMutation`,
// así que si el modelo la llamaba dos veces en un turno ("cómo voy, y ciérralo
// si está bien") repetía las tres lecturas del cuadre MÁS el acumulado del
// ejercicio, que barre el año entero del tenant.
const READ_PREFIXES = ['get_', 'check_', 'list_', 'find_', 'consultar_', 'validar_', 'cuadrar_'];
const isReadOnly = (n: string) => READ_PREFIXES.some((p) => n.startsWith(p));

/**
 * Nombres de tools cuyo schema NO declara ni un solo parámetro.
 *
 * PARA ELLAS, LOS `arguments` NO SIGNIFICAN NADA: el handler recibe `_args` y no
 * lo usa —es la regla estructural de Likida, el modelo decide CUÁNDO y nunca CON
 * QUÉ DATOS—, así que dos llamadas con `{}` y con `{"viaje_id":"v1"}` producen
 * exactamente el mismo resultado.
 *
 * La caché de lectura se llaveaba con `nombre:JSON.stringify(args)` y por eso no
 * acertaba nunca: nada obliga a que `arguments` sea `{}` (los schemas de tools
 * no llevan `strict: true`), así que el modelo variaba el JSON y `cuadrar_viaje`
 * volvía a correr entero. Medido con el ciclo real: tres rondas con `{}`,
 * `{"viaje_id":"v1"}` y `{"incluir_periodo":true}` → 3 ejecuciones, 0 aciertos.
 * Cada una son tres lecturas del cuadre MÁS `getAcumuladoCombustible`, que barre
 * todas las cargas de diésel del EJERCICIO del tenant, dentro de un turno
 * acotado a 40 s.
 *
 * Con parámetros de verdad la llave vuelve a incluirlos: entonces sí describen
 * el efecto.
 */
function llaveDeCache(tools: OpenAI.Chat.ChatCompletionTool[]) {
  const sinParametros = new Set(
    // `flatMap` y no `filter().map()`: el filtro no estrecha el tipo, y
    // `ChatCompletionCustomTool` no tiene `.function`.
    tools.flatMap((t) => {
      if (t.type !== 'function') return [];
      const props = (t.function.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
      return props && Object.keys(props).length > 0 ? [] : [t.function.name];
    }),
  );
  return (name: string, args: Record<string, unknown>) =>
    sinParametros.has(name) ? name : `${name}:${JSON.stringify(args)}`;
}

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
  const llave = llaveDeCache(opts.tools);

  // CR-5: completado con fallback cross-provider. Reintentar SÓLO la llamada de
  // completado (las tools se ejecutan DESPUÉS, en nuestro código) es seguro: una
  // caída del provider nunca re-ejecuta una mutación ni duplica una liquidación.
  const complete = async (msgs: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    const body = () => ({
      model: activeModel,
      messages: msgs,
      tools: opts.tools.length ? opts.tools : undefined,
      tool_choice: opts.tools.length ? ('auto' as const) : undefined,
      // El MISMO techo que las respuestas estructuradas, y por la misma razón
      // (ver DEFAULT_MAX_TOKENS): con `reasoning: 'high'` —que es como corre el
      // rol `cuadre`— el razonamiento invisible y la respuesta comparten este
      // presupuesto. Estaba en 1000: el modelo se quedaba sin techo pensando y
      // devolvía content vacío. `max_tokens` es un TECHO, no un cargo.
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
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
        // SE CORTÓ ≠ TERMINÓ. Sin esta comprobación una respuesta a medias se
        // enviaba como completa, y —peor— una respuesta VACÍA por truncamiento
        // llegaba a `processor.ts` como finalText '' y se convertía en
        // "Listo. 👍": una confirmación afirmativa de un turno en el que no se
        // cuadró nada ni se cerró nada. El chofer deja de mandar comprobantes y
        // el viaje se queda abierto sin que nadie vea un error.
        if (choice?.finish_reason === 'length') {
          throw new TruncatedError(
            `Respuesta truncada en el ciclo de tools: se agotaron los ${opts.maxTokens ?? DEFAULT_MAX_TOKENS} tokens de salida (usó ${tokOut})`,
            tokOut,
            opts.maxTokens ?? DEFAULT_MAX_TOKENS,
            choice?.message?.content ?? undefined,
            { model: used, tokensIn: tokIn, tokensOut: tokOut, cost: costo },
          );
        }
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
          const key = llave(call.function.name, args);
          if (isReadOnly(call.function.name) && crossRound.has(key)) {
            const c = crossRound.get(key)!;
            executed.push({ toolName: call.function.name, args, result: c.result, durationMs: c.durationMs, error: c.error });
            return { role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify(c.success ? c.result : { error: c.error }) };
          }
          let p = inRound.get(key);
          if (!p) { p = opts.toolExecutor(call.function.name, args); inRound.set(key, p); }
          const exec = await p;
          // Solo se cachea el ÉXITO, igual que la rejilla de mutaciones
          // (`tool-executor.ts`). Guardar el fracaso convierte un blip de un
          // segundo en un fallo permanente del turno: el modelo reintenta, se le
          // sirve el mismo error desde memoria, y nadie vuelve a preguntarle a
          // una base que ya se curó sola.
          if (isReadOnly(call.function.name) && exec.success) crossRound.set(key, exec);
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
