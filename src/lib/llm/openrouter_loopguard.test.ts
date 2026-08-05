import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO REINCIDENTE — el loop-guard corría la ÚLTIMA ronda
// COMPLETA antes de tirar `LoopGuardError`, en vez de cortar ANTES.
//
// El `for` permite `maxRounds` vueltas. Si en la última (ronda `maxRounds`) el
// modelo TODAVÍA pide tools en vez de cerrar con texto, no existe una ronda
// siguiente que vaya a leer esas tool_calls — el ciclo iba a tirar
// `LoopGuardError` de todos modos en cuanto el `for` terminara. Ejecutarlas de
// todas formas paga una ronda entera (llamadas de red, y si el modelo pide
// `guardar_liquidacion`, una MUTACIÓN) por un resultado que nadie consume.
//
// La corrección corta ANTES del `Promise.all` que dispara esas tools, no
// después de pagarlas — la llamada al LLM de esa última ronda sigue
// haciéndose (hace falta para SABER que el modelo no iba a cerrar), pero la
// ejecución de sus tools ya no.
// ═══════════════════════════════════════════════════════════════════════════

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools, LoopGuardError, PartialExecutionError } = await import('./openrouter');

// Args DISTINTOS en cada ronda para que la caché de lectura nunca acierte y
// cada ronda dispare una ejecución real — así se puede contar sin ambigüedad
// cuántas rondas de verdad ejecutaron tools.
const pideTool = (n: number) => ({
  choices: [{ message: { content: null, tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'nunca_cierra', arguments: JSON.stringify({ n }) } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});

describe('loop-guard — corta ANTES de ejecutar la ronda que ya sabe que excede el límite', () => {
  beforeEach(() => { create.mockReset(); });

  it('con maxToolRounds:3, la 3ª ronda NO ejecuta su tool antes de tirar LoopGuardError', async () => {
    create
      .mockResolvedValueOnce(pideTool(1))
      .mockResolvedValueOnce(pideTool(2))
      .mockResolvedValueOnce(pideTool(3)); // última ronda permitida: sigue pidiendo tools

    let ejecuciones = 0;
    const err = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'nunca_cierra', description: 'd', parameters: { type: 'object', properties: { n: { type: 'number' } } } } }],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { ok: true }, durationMs: 1 }; },
      maxToolRounds: 3,
    }).catch((e) => e);

    // Las 3 rondas SÍ le preguntan al modelo (hace falta para saber que no iba
    // a cerrar), pero la tool de la 3ª ronda —la que dispara el guard— nunca
    // se ejecuta.
    expect(create).toHaveBeenCalledTimes(3);
    expect(ejecuciones, 'la ronda que excede el límite no debe ejecutar su tool').toBe(2);

    // El guard sigue disparando (envuelto en PartialExecutionError, como
    // siempre) y las tools que SÍ corrieron (rondas 1 y 2) siguen viajando.
    expect(err).toBeInstanceOf(PartialExecutionError);
    expect(err.cause).toBeInstanceOf(LoopGuardError);
    expect(err.partialToolCalls).toHaveLength(2);
    expect(err.partialToolCalls.map((t: { args: { n: number } }) => t.args.n)).toEqual([1, 2]);
  });

  it('si el modelo cierra justo en la última ronda permitida, no hay guard ni tools de más', async () => {
    create
      .mockResolvedValueOnce(pideTool(1))
      .mockResolvedValueOnce(pideTool(2))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'listo', tool_calls: [] } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm' });

    let ejecuciones = 0;
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'nunca_cierra', description: 'd', parameters: { type: 'object', properties: { n: { type: 'number' } } } } }],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { ok: true }, durationMs: 1 }; },
      maxToolRounds: 3,
    });

    expect(ejecuciones).toBe(2);
    expect(r.finalText).toBe('listo');
  });
});
