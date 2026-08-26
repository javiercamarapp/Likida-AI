import { describe, it, expect, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());
const reserve = vi.hoisted(() => vi.fn());
const settle = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./budget', () => ({ reserveLlmBudget: reserve, settleLlmBudget: settle }));
process.env.OPENROUTER_API_KEY = 'test-key';

const { executeTool, generateWithTools, registerTool } = await import('./runtime_guards_imports');

describe('runtime del agente', () => {
  it('una tool abortada no entra al handler', async () => {
    let llamadas = 0;
    registerTool('runtime_abortada', {
      schema: { type: 'function', function: { name: 'runtime_abortada', parameters: { type: 'object', properties: {} } } },
      handler: async () => { llamadas++; return { ok: true }; },
    });
    const controller = new AbortController();
    controller.abort();
    const r = await executeTool('runtime_abortada', {}, { tenantId: 't', signal: controller.signal });
    expect(r.success).toBe(false);
    expect(llamadas).toBe(0);
  });

  it('openrouter entrega la señal a la ejecución de tools', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'runtime_lectura', arguments: '{}' } }] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'm',
    }).mockResolvedValueOnce({
      choices: [{ message: { content: 'listo', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'm',
    });
    registerTool('runtime_lectura', {
      schema: { type: 'function', function: { name: 'runtime_lectura', parameters: { type: 'object', properties: {} } } },
      handler: async () => ({ ok: true }),
    });
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'runtime_lectura', parameters: { type: 'object', properties: {} } } }],
      toolExecutor: async (_name, _args, received) => { signal = received; return { success: true, result: {}, durationMs: 1 }; },
      signal: controller.signal,
      maxToolRounds: 2,
    });
    expect(signal).toBe(controller.signal);
  });

  it('conserva la reserva si el proveedor omite usage', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'listo', tool_calls: [] } }],
      model: 'm',
    });
    reserve.mockResolvedValueOnce({ id: 'reservation-1', amountUsd: 0.25 });
    const budget = { tenantId: 'tenant-1', runId: 'run-1', maxRunUsd: 1, maxTenantDailyUsd: 5, reservadoRunUsd: 0 };
    await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [], toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
      budget,
    });
    expect(settle).toHaveBeenCalledWith(budget, { id: 'reservation-1', amountUsd: 0.25 }, 0.25);
  });

  it('RENDIMIENTO-19C2-1: reservar y liquidar heredan la señal (un cliente de red profundo puede cancelarse con ella)', async () => {
    const { currentToolSignal } = await import('./runtime-signal');
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'listo', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'm',
    });
    let signalAlReservar: AbortSignal | undefined;
    let signalAlLiquidar: AbortSignal | undefined;
    reserve.mockImplementationOnce(async () => { signalAlReservar = currentToolSignal(); return { id: 'r-1', amountUsd: 0.1 }; });
    settle.mockImplementationOnce(async () => { signalAlLiquidar = currentToolSignal(); });
    const controller = new AbortController();
    const budget = { tenantId: 't', runId: 'r', maxRunUsd: 1, maxTenantDailyUsd: 5, reservadoRunUsd: 0 };
    await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [], toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
      budget, signal: controller.signal,
    });
    expect(signalAlReservar).toBe(controller.signal);
    expect(signalAlLiquidar).toBe(controller.signal);
  });

  it('RENDIMIENTO-19C2-1: la señal ya disparada corta ANTES de pagar la siguiente ronda de completion', async () => {
    const llamadasAntes = create.mock.calls.length;
    const controller = new AbortController();
    create.mockResolvedValueOnce({
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'runtime_corta_luego', arguments: '{}' } }] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'm',
    });
    registerTool('runtime_corta_luego', {
      schema: { type: 'function', function: { name: 'runtime_corta_luego', parameters: { type: 'object', properties: {} } } },
      handler: async () => ({ ok: true }),
    });
    await expect(generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'runtime_corta_luego', parameters: { type: 'object', properties: {} } } }],
      toolExecutor: async () => {
        controller.abort(); // la tool "gasta" el resto del tiempo y dispara la señal
        return { success: true, result: {}, durationMs: 1 };
      },
      signal: controller.signal,
      maxToolRounds: 3,
    })).rejects.toThrow();
    expect(create.mock.calls.length - llamadasAntes).toBe(1); // nunca llegó a pedir la segunda ronda
  });
});
