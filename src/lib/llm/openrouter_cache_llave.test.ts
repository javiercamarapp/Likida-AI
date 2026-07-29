import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';

// ═══════════════════════════════════════════════════════════════════════════
// LA CACHÉ DE LECTURA SE ANULABA CON CUALQUIER VARIACIÓN DE `arguments`.
//
// `READ_PREFIXES` metió `cuadrar_` en la lista a propósito: `cuadrar_viaje`
// calcula y no escribe, y si el modelo la llama dos veces en un turno ("cómo
// voy, y ciérralo si está bien") repite tres lecturas del cuadre MÁS
// `getAcumuladoCombustible`, que barre TODAS las cargas de diésel del ejercicio
// del tenant. La lista acertó; la llave no: era
// `nombre:JSON.stringify(args)` mientras el handler ignora `args` por completo
// (`tools.ts:52`, `_args`).
//
// Nada obliga a que `arguments` sea `{}`: los schemas de tools no llevan
// `strict: true` (el único del repo está en el `json_schema` del OCR). Medido
// con el ciclo real: `{}` · `{"viaje_id":"v1"}` · `{"incluir_periodo":true}` en
// tres rondas → 3 ejecuciones, 0 aciertos de caché, dentro de un turno acotado
// a 40 s.
// ═══════════════════════════════════════════════════════════════════════════

const crear = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => crear(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools } = await import('./openrouter');

const SIN_PARAMS: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'cuadrar_viaje',
    description: 'cuadra el viaje',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

const CON_PARAMS: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_algo',
    description: 'lee algo por id',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
  },
};

/** Una respuesta con tool_calls; la última ronda cierra con texto. */
const conTools = (name: string, args: string) => ({
  choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `c-${Math.random()}`, type: 'function', function: { name, arguments: args } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  model: 'x',
});
const cierre = () => ({
  choices: [{ finish_reason: 'stop', message: { content: 'listo', tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  model: 'x',
});

beforeEach(() => { crear.mockReset(); });

describe('caché de lectura — la llave describe el EFECTO, no la llamada', () => {
  it('una tool SIN parámetros se ejecuta una sola vez aunque el modelo varíe los args', async () => {
    let ejecuciones = 0;
    crear
      .mockResolvedValueOnce(conTools('cuadrar_viaje', '{}'))
      .mockResolvedValueOnce(conTools('cuadrar_viaje', '{"viaje_id":"v1"}'))
      .mockResolvedValueOnce(conTools('cuadrar_viaje', '{"incluir_periodo":true}'))
      .mockResolvedValueOnce(cierre());

    const r = await generateWithTools({
      role: 'cuadre', system: 's', messages: [{ role: 'user', content: 'cómo voy' }],
      tools: [SIN_PARAMS],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { total: 1 }, durationMs: 1 }; },
    });

    expect(ejecuciones).toBe(1);
    // Las tres rondas sí se le contestan al modelo: lo que no se repite es el
    // trabajo contra Postgres.
    expect(r.toolCalls).toHaveLength(3);
    expect(r.toolCalls.every((t) => JSON.stringify(t.result) === JSON.stringify({ total: 1 }))).toBe(true);
  });

  it('una tool CON parámetros sigue cacheándose por args: ahí sí describen el efecto', async () => {
    let ejecuciones = 0;
    crear
      .mockResolvedValueOnce(conTools('get_algo', '{"id":"a"}'))
      .mockResolvedValueOnce(conTools('get_algo', '{"id":"b"}'))
      .mockResolvedValueOnce(conTools('get_algo', '{"id":"a"}'))
      .mockResolvedValueOnce(cierre());

    await generateWithTools({
      role: 'cuadre', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [CON_PARAMS],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: {}, durationMs: 1 }; },
    });

    // 'a' y 'b' son lecturas distintas; el segundo 'a' sí sale de caché.
    expect(ejecuciones).toBe(2);
  });

  it('un FRACASO sigue sin cachearse, con la llave nueva', async () => {
    let ejecuciones = 0;
    crear
      .mockResolvedValueOnce(conTools('cuadrar_viaje', '{}'))
      .mockResolvedValueOnce(conTools('cuadrar_viaje', '{"otra":"cosa"}'))
      .mockResolvedValueOnce(cierre());

    await generateWithTools({
      role: 'cuadre', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [SIN_PARAMS],
      toolExecutor: async () => {
        ejecuciones++;
        return ejecuciones === 1
          ? { success: false, result: null, error: 'blip', durationMs: 1 }
          : { success: true, result: { total: 1 }, durationMs: 1 };
      },
    });

    expect(ejecuciones).toBe(2);
  });
});
