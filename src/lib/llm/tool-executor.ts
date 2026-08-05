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
  /**
   * BAJO (auditoría 10, reincidente, sin resolver A PROPÓSITO). `run.ts` crea
   * un `AbortController` con `timeoutMs` y lo pasa aquí, pero NINGÚN handler de
   * `tools.ts` lo lee — ni `ctx.signal.throwIfAborted()` ni pasarlo a una
   * llamada cancelable. Documentado en vez de conectado porque hacerlo bien no
   * es tocar `tools.ts`: cada handler llama funciones de `repo.ts` (y
   * `cuadre/desde_db.ts`, `config.ts`) que pasan por `acotada()`
   * (`presupuesto.ts:148`), y esa es la única que de verdad puede cancelar el
   * socket (`.abortSignal(...)`). Conectar `ctx.signal` bien haría falta
   * combinarlo ahí con el `AbortSignal.timeout(TOPE_CONSULTA_MS)` propio de
   * CADA consulta (`AbortSignal.any([...])`) y enhebrarlo por las ~19 funciones
   * de `repo.ts` que hoy no lo reciben — cambio de rubro backend, no de
   * tool-calling, y de superficie mucho mayor que un handler.
   *
   * MITIGANTE YA ACTIVO: cada consulta de `repo.ts` muere sola a los
   * `TOPE_CONSULTA_MS` (8s) + `GRACIA_TOPE_MS` (1.5s) exista o no `ctx.signal`
   * — no hay fuga de conexión ni cuelgue indefinido. Lo que NO cubre el
   * mitigante: si al turno le quedan, digamos, 2s de presupuesto real
   * (`run.ts` ya expiró su `AbortController`), una consulta en vuelo sigue
   * corriendo hasta SU propio tope de 8s en vez de morir con el turno —
   * trabajo desperdiciado, no un recurso que no se libera.
   */
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

// BAJO (auditoría 10, reincidente) — EL ERROR CRUDO DE POSTGRES NO CRUZA HACIA
// EL MODELO.
//
// `repo.ts` envuelve el error de PostgREST como `Error("saveLiquidacion: " +
// error.message)` (mismo patrón en ~14 funciones del archivo) y lo LANZA.
// Sin filtrar aquí, ese `.message` —tal cual lo manda Postgres— llegaba a
// `ToolExecResult.error` y de ahí, sin más escalas, al `content` del mensaje
// `role: 'tool'` que el modelo LEE (`openrouter.ts`:
// `JSON.stringify(exec.success ? exec.result : { error: exec.error })`). Un
// mensaje de Postgres nombra tablas, columnas y constraints — el mismo criterio
// que ya aplica el repo para no exponer lo interno (`guardiaFundamento` filtra
// qué norma se puede citar, `redactarTexto` filtra qué PII sale en los logs)
// dice que esto tampoco debería cruzar tal cual.
//
// Se distingue por VOCABULARIO, no por origen (`err.code` ya se perdió: el
// `throw new Error(...)` de repo.ts solo conserva `.message`), así que un
// mensaje de negocio deliberado ("sin viaje activo", "el operador no
// pertenece a esta flota") pasa intacto — el modelo lo necesita para
// reaccionar — y solo se acota lo que suena a Postgres de verdad.
const VOCABULARIO_POSTGRES = /\b(relation|column|constraint|violates|duplicate key|syntax error|permission denied|invalid input syntax|null value in)\b/i;

/** El detalle completo SIGUE en el log (`logger.error`, abajo) — solo se acota lo que ve el modelo. */
function mensajeParaElModelo(mensaje: string): string {
  return VOCABULARIO_POSTGRES.test(mensaje)
    ? 'la operación no se pudo completar por un error interno de datos'
    : mensaje;
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
    const crudo = err instanceof Error ? err.message : String(err);
    // El log SÍ se queda con el mensaje completo — es el canal de
    // observabilidad, no el que lee el modelo.
    logger.error('tool.error', { name, err: crudo });
    return {
      success: false,
      result: null,
      error: mensajeParaElModelo(crudo),
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
 * DB (unique(viaje_id) + upsert), pero es un backstop: esta rejilla es la que
 * evita el trabajo, no solo la fila duplicada.
 */
export function makeExecutor(ctx: ToolContext) {
  // SE CACHEA LA PROMESA, NO EL RESULTADO — y por eso el tipo es Promise<…>.
  //
  // Con `ToolExecResult` la secuencia era `get` … `await` … `set`: una ventana
  // de check-then-act tan ancha como el handler. `generateWithTools` lanza TODAS
  // las tool_calls de una ronda con `Promise.all` (openrouter.ts), así que dos
  // invocaciones concurrentes pasaban las dos por el `if` con la caché vacía, el
  // handler corría dos veces y `tool.mutation_dedup` NO se disparaba: en el log
  // parecía que la rejilla había funcionado.
  //
  // Medido sobre `guardar_liquidacion`: 2 cuadres completos, 4 PDFs, 4 subidas a
  // Storage sobre las mismas dos rutas y 2 RPC de escritura. La otra rejilla
  // (`inRound`, en openrouter.ts) no lo tapaba: se llavea con
  // `nombre:JSON.stringify(args)` y basta un `{"confirmar":true}` para esquivarla
  // — nada obliga a que `arguments` sea `{}`, los schemas de tools no llevan
  // `strict: true`.
  //
  // Registrando la promesa ANTES del await, el segundo llamador se engancha a la
  // MISMA ejecución. No hay ventana: entre el `get` y el `set` no hay await.
  const mutacionesHechas = new Map<string, Promise<ToolExecResult>>();
  return async (name: string, args: Record<string, unknown>): Promise<ToolExecResult> => {
    if (REGISTRY.get(name)?.isMutation) {
      // LA LLAVE ES EL NOMBRE, no los args. Ninguna tool de Likida tiene
      // parámetros a propósito —el modelo decide CUÁNDO, nunca CON QUÉ DATOS, y
      // el efecto sale de ctx.tenantId/ctx.viajeId—, así que meter `args` en la
      // llave describía la llamada y no el efecto: un byte de diferencia, o las
      // mismas claves en otro orden, y la mutación corría dos veces. Si algún día
      // una tool sí decide sobre datos, esta llave tiene que volver a incluirlos
      // — y ese día habrá que revisar la regla de `properties: {}` antes que esta
      // línea.
      const key = name;
      const cache = mutacionesHechas.get(key);
      if (cache) { logger.warn('tool.mutation_dedup', { name }); return cache; }
      // `executeTool` nunca rechaza (captura y devuelve `success:false`), así que
      // esta promesa no puede quedar como rejection sin manejar.
      const p = executeTool(name, args, ctx);
      mutacionesHechas.set(key, p);
      const res = await p;
      // Un FALLO no se queda cacheado: un blip de un segundo no puede convertirse
      // en un fallo permanente del turno. Se compara la promesa antes de borrar
      // para no tirar el reintento de otro llamador que ya ocupó la llave.
      if (!res.success && mutacionesHechas.get(key) === p) mutacionesHechas.delete(key);
      return res;
    }
    return executeTool(name, args, ctx);
  };
}
