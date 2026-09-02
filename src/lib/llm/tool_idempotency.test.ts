import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const claim = vi.hoisted(() => vi.fn());
const complete = vi.hoisted(() => vi.fn());
const fail = vi.hoisted(() => vi.fn());
const renew = vi.hoisted(() => vi.fn());
vi.mock('./tool-idempotency', () => ({ claimMutation: claim, completeMutation: complete, failMutation: fail, renewMutation: renew }));
const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: loggerError } }));

const { executeTool, registerTool, timeoutToolMs } = await import('./tool-executor');

describe('idempotencia durable de mutaciones', () => {
  beforeEach(() => { claim.mockReset(); complete.mockReset(); fail.mockReset(); renew.mockReset(); loggerError.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('AGEN-19C2-3: una mutación tiene más margen de timeout que una tool de sólo lectura', () => {
    expect(timeoutToolMs(true)).toBeGreaterThan(timeoutToolMs(false));
    expect(timeoutToolMs()).toBe(timeoutToolMs(false));
  });

  it('AGEN-19C2-3: LIKIDA_TOOL_MUTATION_TIMEOUT_MS solo afecta a las mutaciones', () => {
    vi.stubEnv('LIKIDA_TOOL_MUTATION_TIMEOUT_MS', '7777');
    expect(timeoutToolMs(true)).toBe(7777);
    expect(timeoutToolMs(false)).not.toBe(7777);
  });

  it('AGEN-19C2-3 (Fable-5): sin LIKIDA_TOOL_MUTATION_TIMEOUT_MS, una mutación nunca tiene MENOS margen que el genérico', () => {
    // Un deployment que ya subió el timeout genérico por encima de 40s (y no
    // toca la variable nueva) no debe darle a una mutación MENOS margen que
    // a una tool de sólo lectura — el bug real: antes caía a un 40_000 fijo
    // sin mirar el genérico.
    vi.stubEnv('LIKIDA_TOOL_TIMEOUT_MS', '60000');
    expect(timeoutToolMs(true)).toBeGreaterThanOrEqual(timeoutToolMs(false));
    expect(timeoutToolMs(true)).toBe(60_000);
  });

  it('reclama y confirma el efecto con fencing token', async () => {
    claim.mockResolvedValueOnce({ kind: 'execute', token: 'token-1' });
    complete.mockResolvedValueOnce(undefined);
    registerTool('durable_mutation', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'durable_mutation', parameters: { type: 'object', properties: {} } } },
      handler: async () => ({ saved: true }),
    });
    const r = await executeTool('durable_mutation', {}, { tenantId: 't', viajeId: 'v', runId: 'r' });
    expect(r.success).toBe(true);
    expect(claim).toHaveBeenCalledWith('t', 'durable_mutation:t:v:-:r', 'durable_mutation');
    expect(complete).toHaveBeenCalledWith('t', 'durable_mutation:t:v:-:r', 'token-1', { saved: true });
  });

  it('falla cerrado sin runId y no entra al handler', async () => {
    const handler = vi.fn(async () => ({ saved: true }));
    registerTool('mutation_without_run_id', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'mutation_without_run_id', parameters: { type: 'object', properties: {} } } },
      handler,
    });
    const r = await executeTool('mutation_without_run_id', {}, { tenantId: 't', viajeId: 'v' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/runida|corrida identificada/i);
    expect(handler).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('sirve el resultado durable y no toca el handler', async () => {
    claim.mockResolvedValueOnce({ kind: 'cached', result: { saved: true } });
    const handler = vi.fn(async () => ({ saved: false }));
    registerTool('durable_cached', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'durable_cached', parameters: { type: 'object', properties: {} } } },
      handler,
    });
    const r = await executeTool('durable_cached', {}, { tenantId: 't', viajeId: 'v', runId: 'r' });
    expect(r.result).toEqual({ saved: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('si otro worker tiene el lease, falla cerrado y no ejecuta el handler', async () => {
    claim.mockResolvedValueOnce({ kind: 'busy' });
    const handler = vi.fn(async () => ({ saved: true }));
    registerTool('durable_busy', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'durable_busy', parameters: { type: 'object', properties: {} } } },
      handler,
    });
    const r = await executeTool('durable_busy', {}, { tenantId: 't', viajeId: 'v', runId: 'r' });
    expect(r.success).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('un fallo del handler sella failed con el mismo fencing token', async () => {
    claim.mockResolvedValueOnce({ kind: 'execute', token: 'token-fail' });
    fail.mockResolvedValueOnce(undefined);
    registerTool('durable_fail', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'durable_fail', parameters: { type: 'object', properties: {} } } },
      handler: async () => { throw new Error('fallo controlado'); },
    });
    const r = await executeTool('durable_fail', {}, { tenantId: 't', viajeId: 'v', runId: 'r' });
    expect(r.success).toBe(false);
    expect(fail).toHaveBeenCalledWith('t', 'durable_fail:t:v:-:r', 'token-fail', 'fallo controlado');
  });

  it('el handler recibe la señal enlazada y observa la cancelación del turno', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    registerTool('signal_tool', {
      schema: { type: 'function', function: { name: 'signal_tool', parameters: { type: 'object', properties: {} } } },
      handler: async (_args, ctx) => {
        received = ctx.signal;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { aborted: ctx.signal?.aborted };
      },
    });
    const pending = executeTool('signal_tool', {}, { tenantId: 't', signal: controller.signal });
    controller.abort();
    const r = await pending;
    expect(received).toBeDefined();
    expect(received).not.toBe(controller.signal);
    expect(received?.aborted).toBe(true);
    expect(r.success).toBe(false);
  });

  it('devuelve timeout aunque un handler no coopere con AbortSignal', async () => {
    vi.stubEnv('LIKIDA_TOOL_TIMEOUT_MS', '5');
    registerTool('ignora_signal', {
      schema: { type: 'function', function: { name: 'ignora_signal', parameters: { type: 'object', properties: {} } } },
      handler: async () => new Promise(() => undefined),
    });
    const r = await executeTool('ignora_signal', {}, { tenantId: 't' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Timeout|abortada/i);
  });

  it('mantiene el fencing de una mutación que termina después del timeout', async () => {
    // AGEN-19C2-3: una tool `isMutation` usa LIKIDA_TOOL_MUTATION_TIMEOUT_MS
    // (con más margen por defecto), no LIKIDA_TOOL_TIMEOUT_MS.
    vi.stubEnv('LIKIDA_TOOL_MUTATION_TIMEOUT_MS', '5');
    claim.mockResolvedValueOnce({ kind: 'execute', token: 'token-late' });
    complete.mockResolvedValueOnce(undefined);
    registerTool('mutacion_lenta_no_cooperante', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'mutacion_lenta_no_cooperante', parameters: { type: 'object', properties: {} } } },
      handler: async () => new Promise((resolve) => setTimeout(() => resolve({ committed: true }), 15)),
    });
    const r = await executeTool('mutacion_lenta_no_cooperante', {}, { tenantId: 't', viajeId: 'v', runId: 'r' });
    expect(r.success).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(complete).toHaveBeenCalledWith('t', 'mutacion_lenta_no_cooperante:t:v:-:r', 'token-late', { committed: true });
    expect(fail).not.toHaveBeenCalled();
  });

  it('TOOL-CALLING-19C2-2: un handler que nunca asienta su promesa deja de renovar el lease tras el techo', async () => {
    // Un timeout de tool enorme (nunca dispara en esta ventana de prueba)
    // aísla la señal que se quiere probar: el TECHO de renovaciones, no el
    // deadline del executor. El lease se ajusta al piso real (1s) para no
    // necesitar minutos de tiempo simulado.
    vi.stubEnv('LIKIDA_TOOL_MUTATION_TIMEOUT_MS', '100000000');
    vi.stubEnv('LIKIDA_TOOL_IDEMPOTENCY_LEASE_MS', '100');
    claim.mockResolvedValueOnce({ kind: 'execute', token: 'token-colgado' });
    renew.mockResolvedValue(true);
    registerTool('mutacion_colgada', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'mutacion_colgada', parameters: { type: 'object', properties: {} } } },
      handler: async () => new Promise(() => undefined), // nunca resuelve ni rechaza
    });

    vi.useFakeTimers();
    try {
      void executeTool('mutacion_colgada', {}, { tenantId: 't', viajeId: 'v', runId: 'r' });
      await vi.advanceTimersByTimeAsync(0); // deja correr el claim (microtask) antes del primer tick
      await vi.advanceTimersByTimeAsync(1000 * 11); // 11 ticks de 1s (el piso real de renewEveryMs)
    } finally {
      vi.useRealTimers();
    }

    expect(renew).toHaveBeenCalledTimes(10); // el 11º tick ya no renueva: hit el techo
    expect(loggerError).toHaveBeenCalledWith('tool.lease_renovacion_techo', expect.objectContaining({ renovaciones: 11 }));
  });
});
