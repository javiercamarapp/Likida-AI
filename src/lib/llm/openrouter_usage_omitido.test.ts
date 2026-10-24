import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// A37-S60-05: si el proveedor omite `usage`, el ledger conserva la RESERVA. El costo que se
// devuelve (y se escribe en `llm_costo`) debe decir lo mismo y llevar `noMedido`, no un $0
// con cara de medición.

const create = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (query: unknown) => query }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateStructured, generateWithTools } = await import('./openrouter');
const { createLlmBudget } = await import('./budget');

const esquema = z.object({ monto: z.number() });
const reservaPedida = () =>
  (rpc.mock.calls.find((c) => c[0] === 'reservar_presupuesto_llm')?.[1] as { p_reserva_usd: number }).p_reserva_usd;

beforeEach(() => {
  create.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => ({ data: fn === 'reservar_presupuesto_llm' ? 'ok' : true, error: null }));
});

describe('A37-S60-05 · generateStructured sin usage', () => {
  it('devuelve la reserva como costo y marca noMedido', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '{"monto":1}' } }], model: 'google/gemini-3.1-flash-lite' });
    const budget = createLlmBudget('t-s60-05a', '00000000-0000-4000-8000-0000000a3705', 'interactivo');
    const r = await generateStructured({
      role: 'ocr', system: 's', messages: [{ role: 'user', content: 'x' }], schema: esquema, schemaName: 'c', budget,
    });
    expect(r.noMedido).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
    expect(r.cost).toBeCloseTo(reservaPedida(), 6);
  });

  it('con usage medido NO lleva la marca y el costo es el medido', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: '{"monto":1}' } }], model: 'google/gemini-3.1-flash-lite',
      usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0004 },
    });
    const budget = createLlmBudget('t-s60-05b', '00000000-0000-4000-8000-0000000b3705', 'interactivo');
    const r = await generateStructured({
      role: 'ocr', system: 's', messages: [{ role: 'user', content: 'x' }], schema: esquema, schemaName: 'c', budget,
    });
    expect(r.noMedido).toBeUndefined();
    expect(r.cost).toBe(0.0004);
  });
});

describe('A37-S60-05 · generateWithTools sin usage', () => {
  it('devuelve la reserva como costo y marca noMedido', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'listo' }, finish_reason: 'stop' }], model: 'anthropic/claude-sonnet-4.6',
    });
    const budget = createLlmBudget('t-s60-05c', '00000000-0000-4000-8000-0000000c3705', 'interactivo');
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'hola' }], tools: [],
      toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }), budget,
    });
    expect(r.noMedido).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
    expect(r.cost).toBeCloseTo(reservaPedida(), 6);
  });
});
