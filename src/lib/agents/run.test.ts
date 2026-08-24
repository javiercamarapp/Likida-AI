import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDITORÍA 18 · M21 — `runAgent` no pasaba maxTokens ni maxToolRounds: el
// ciclo del cuadre (Sonnet con reasoning high, $10/M de salida) caía al
// default mudo de openrouter.ts. Aquí se fija que el techo se DECLARA, que
// no se degrada a los 900 de los chats (el razonamiento comparte el
// presupuesto) y que se mueve con una variable de entorno.
const generateWithTools = vi.fn(async (_o: unknown) => ({
  finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, cost: 0, costoPorModelo: {},
}));
vi.mock('@/lib/llm/openrouter', () => ({ generateWithTools: (o: unknown) => generateWithTools(o) }));
vi.mock('@/lib/llm/tool-executor', () => ({ toolSchemas: () => [], makeExecutor: () => async () => ({ success: true, result: {}, durationMs: 0 }) }));
vi.mock('./prompts', () => ({ getSystemPrompt: () => 'sistema' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { runAgent, maxTokensCuadre, maxRondasCuadre, timeoutAgenteMs } = await import('./run');

const TENANT = { tenantId: 't-1' } as never;
const correr = () => runAgent({ agent: 'liquidacion', tenant: TENANT, ctx: { tenantId: 't-1' } as never, history: [] });

describe('M21 — el techo del cuadre se declara, no se hereda', () => {
  beforeEach(() => { generateWithTools.mockClear(); vi.unstubAllEnvs(); });

  it('sin env: 4,000 tokens por ronda y 6 rondas, explícitos en la llamada', async () => {
    await correr();
    const opts = generateWithTools.mock.calls[0][0] as { maxTokens: number; maxToolRounds: number; reasoning?: string };
    expect(opts.maxTokens).toBe(4000);
    expect(opts.maxToolRounds).toBe(6);
    expect(opts.reasoning).toBe('high');
  });

  it('LIKIDA_CUADRE_MAX_TOKENS / LIKIDA_CUADRE_MAX_RONDAS mueven el techo sin despliegue', async () => {
    vi.stubEnv('LIKIDA_CUADRE_MAX_TOKENS', '2500');
    vi.stubEnv('LIKIDA_CUADRE_MAX_RONDAS', '4');
    await correr();
    const opts = generateWithTools.mock.calls[0][0] as { maxTokens: number; maxToolRounds: number };
    expect(opts.maxTokens).toBe(2500);
    expect(opts.maxToolRounds).toBe(4);
  });

  it('un valor basura en la env cae al default, no a NaN ni a 0 (que sería "sin techo" o "sin rondas")', () => {
    vi.stubEnv('LIKIDA_CUADRE_MAX_TOKENS', '[SENSITIVE]');
    vi.stubEnv('LIKIDA_CUADRE_MAX_RONDAS', '-3');
    expect(maxTokensCuadre()).toBe(4000);
    expect(maxRondasCuadre()).toBe(6);
  });

  it('si no se especifica timeout, el agente conserva un backstop efectivo', () => {
    vi.stubEnv('LIKIDA_AGENT_TIMEOUT_MS', '');
    expect(timeoutAgenteMs()).toBe(40_000);
    vi.stubEnv('LIKIDA_AGENT_TIMEOUT_MS', '2500');
    expect(timeoutAgenteMs()).toBe(2500);
  });

  it('combina la señal externa y entrega una identidad de corrida al runtime', async () => {
    const externo = new AbortController();
    await runAgent({ agent: 'liquidacion', tenant: TENANT, ctx: { tenantId: 't-1' } as never, history: [], signal: externo.signal });
    const opts = generateWithTools.mock.calls.at(-1)?.[0] as { signal: AbortSignal; budget: { tenantId: string; runId: string } };
    expect(opts.signal).not.toBe(externo.signal);
    expect(opts.signal.aborted).toBe(false);
    expect(opts.budget.tenantId).toBe('t-1');
    expect(opts.budget.runId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
