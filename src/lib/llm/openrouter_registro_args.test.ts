import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · MEDIO REINCIDENTE — `ToolCallRecord.args` EN LA CACHÉ NO
// DESCRIBÍA QUÉ ARGS PRODUJERON EL `result` QUE TRAE.
//
// Ninguna tool de Likida tiene parámetros a propósito (`properties: {}`): el
// handler recibe `_args` y no lo usa, el modelo decide CUÁNDO y nunca CON QUÉ
// DATOS. Nada obliga a que `arguments` sea `{}` (los schemas no llevan
// `strict: true`), así que el modelo puede variar los args entre llamadas sin
// que cambie el efecto — y eso es justo lo que rompía el registro:
//
//   ronda 1: cuadrar_viaje({"a":1})   → SE EJECUTA, llena la caché
//   ronda 2: cuadrar_viaje({"b":2})   → acierta la caché (misma llave, sin
//                                        params: la llave es el NOMBRE)
//
// `executed.push({ args, result: c.result, ... })` usaba los args de la RONDA
// 2 junto al resultado que produjo la RONDA 1: el registro decía que
// `{"b":2}` produjo ese resultado, y lo que de verdad lo produjo fue
// `{"a":1}`. Mismo defecto dentro de una sola ronda (`inRound`) cuando el
// modelo pide la misma tool dos veces en el mismo turno con args distintos.
//
// Hoy no cambia ningún comportamiento observable por el operador —las tres
// tools registradas ignoran `args`—, pero el día que una tool sí decida sobre
// datos, este campo es la única forma de auditar "qué llamada produjo qué".
// ═══════════════════════════════════════════════════════════════════════════

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools } = await import('./openrouter');

const SIN_PARAMS = { type: 'function' as const, function: { name: 'consultar_politica', description: 'd', parameters: { type: 'object', properties: {}, additionalProperties: false } } };

const llamaTool = (args: string, id = 'c1') => ({
  choices: [{ message: { content: null, tool_calls: [{ id, type: 'function', function: { name: 'consultar_politica', arguments: args } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});
const dosLlamadasEnLaMismaRonda = (args1: string, args2: string) => ({
  choices: [{ message: { content: null, tool_calls: [
    { id: 'c1', type: 'function', function: { name: 'consultar_politica', arguments: args1 } },
    { id: 'c2', type: 'function', function: { name: 'consultar_politica', arguments: args2 } },
  ] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});
const cierre = () => ({
  choices: [{ message: { content: 'listo', tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});

describe('la caché entre rondas registra los args que PRODUJERON el resultado', () => {
  beforeEach(() => { create.mockReset(); });

  it('ronda 2 acierta la caché de la ronda 1: el registro trae los args de la ronda 1, no los suyos', async () => {
    create
      .mockResolvedValueOnce(llamaTool('{"a":1}', 'c1'))
      .mockResolvedValueOnce(llamaTool('{"b":2}', 'c2'))
      .mockResolvedValueOnce(cierre());

    let ejecuciones = 0;
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [SIN_PARAMS],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { politica: 'p' }, durationMs: 1 }; },
    });

    expect(ejecuciones, 'solo la ronda 1 debe ejecutar de verdad').toBe(1);
    expect(r.toolCalls).toHaveLength(2);
    // La ronda 1 SÍ ejecutó con {"a":1} — control.
    expect(r.toolCalls[0].args).toEqual({ a: 1 });
    // La ronda 2 acertó la caché: el resultado es el de la ronda 1, y el
    // registro tiene que decir CON QUÉ ARGS se produjo ese resultado — {"a":1},
    // no los {"b":2} que el modelo mandó esta vez y que nunca se ejecutaron.
    expect(r.toolCalls[1].args, 'debe traer los args que PRODUJERON el resultado cacheado').toEqual({ a: 1 });
    expect(r.toolCalls[1].result).toEqual({ politica: 'p' });
  });
});

describe('el dedup DENTRO de una ronda registra los args de la llamada que sí disparó la ejecución', () => {
  beforeEach(() => { create.mockReset(); });

  it('dos tool_calls de la MISMA ronda, args distintos, una sola ejecución: las dos quedan con los args que corrieron', async () => {
    create
      .mockResolvedValueOnce(dosLlamadasEnLaMismaRonda('{"a":1}', '{"b":2}'))
      .mockResolvedValueOnce(cierre());

    let ejecuciones = 0;
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [SIN_PARAMS],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { politica: 'p' }, durationMs: 1 }; },
    });

    expect(ejecuciones, 'la segunda llamada de la ronda reusa la promesa de la primera').toBe(1);
    expect(r.toolCalls).toHaveLength(2);
    // Ambos registros describen la ÚNICA llamada que de verdad corrió: {"a":1}.
    expect(r.toolCalls[0].args).toEqual({ a: 1 });
    expect(r.toolCalls[1].args, 'la segunda no debe quedar con {"b":2}: eso nunca se ejecutó').toEqual({ a: 1 });
  });
});
