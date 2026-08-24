import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (query: unknown) => query }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateResponse } = await import('./openrouter');
const { createLlmBudget } = await import('./budget');

describe('generateResponse — reserva central cuando usage falta', () => {
  beforeEach(() => {
    create.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
  });

  it('con usage ausente conserva la reserva y reporta el costo contabilizado', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' } }],
      model: 'modelo-sin-usage',
    });
    const budget = createLlmBudget('tenant-usage', '00000000-0000-4000-8000-000000000009');
    const r = await generateResponse({
      role: 'back_office',
      system: 'sistema',
      messages: [{ role: 'user', content: 'redacta' }],
      budget,
    });

    expect(r.cost).toBeGreaterThan(0);
    expect(rpc).toHaveBeenNthCalledWith(1, 'reservar_presupuesto_llm', expect.objectContaining({ p_tenant_id: 'tenant-usage' }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'liquidar_presupuesto_llm', expect.objectContaining({ p_costo_real_usd: expect.any(Number) }));
    expect(budget.reservadoRunUsd).toBeGreaterThan(0);
  });
});
