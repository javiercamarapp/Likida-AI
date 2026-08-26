import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (query: unknown) => query }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: loggerError } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateResponse } = await import('./openrouter');
const { createLlmBudget } = await import('./budget');

describe('generateResponse — reserva central cuando usage falta', () => {
  beforeEach(() => {
    create.mockReset();
    rpc.mockReset();
    loggerError.mockReset();
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

  it('BACKEND-19C2-1: si el proveedor truena, NO liquida al monto reservado — deja la fila para que la 0193 la excluya sola', async () => {
    create.mockRejectedValueOnce(new Error('el modelo rechazó la petición (dato de negocio, no red)'));
    const budget = createLlmBudget('tenant-error', '00000000-0000-4000-8000-00000000000a');

    await expect(generateResponse({
      role: 'back_office',
      system: 'sistema',
      messages: [{ role: 'user', content: 'redacta' }],
      budget,
    })).rejects.toThrow();

    expect(rpc).toHaveBeenCalledWith('reservar_presupuesto_llm', expect.objectContaining({ p_tenant_id: 'tenant-error' }));
    expect(rpc).not.toHaveBeenCalledWith('liquidar_presupuesto_llm', expect.anything());
    expect(loggerError).toHaveBeenCalledWith('llm.reserva_sin_liquidar_por_error', expect.objectContaining({ reservaId: expect.any(String) }));
  });
});
