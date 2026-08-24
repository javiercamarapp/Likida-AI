import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({
  acotada: (consulta: PromiseLike<unknown>) => consulta,
}));

const { claimMutation, completeMutation, failMutation, renewMutation } = await import('./tool-idempotency');

describe('idempotencia de tools: reloj de PostgreSQL y concurrencia', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no serializa lease_until con el reloj de la instancia', async () => {
    rpc.mockResolvedValue({ data: [{ kind: 'execute', token: 'token-db' }], error: null });

    vi.setSystemTime(new Date('2099-12-31T23:59:59.000Z'));
    const adelantado = await claimMutation('tenant-1', 'effect-1', 'tool-a');
    const argsAdelantado = rpc.mock.calls[0]?.[1];

    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    const atrasado = await claimMutation('tenant-1', 'effect-1', 'tool-a');
    const argsAtrasado = rpc.mock.calls[1]?.[1];

    expect(adelantado).toEqual({ kind: 'execute', token: 'token-db' });
    expect(atrasado).toEqual({ kind: 'execute', token: 'token-db' });
    expect(argsAdelantado).toEqual(argsAtrasado);
    expect(argsAdelantado).not.toHaveProperty('p_lease_until');
    expect(argsAdelantado).toEqual({
      p_tenant_id: 'tenant-1',
      p_effect_key: 'effect-1',
      p_tool_name: 'tool-a',
      p_lease_seconds: 120,
    });
  });

  it('delega la carrera concurrente al RPC y conserva el fencing que devuelve la base', async () => {
    rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      const first = rpc.mock.calls.length === 1;
      return {
        data: [{ kind: first ? 'execute' : 'busy', token: first ? 'token-a' : null }],
        error: null,
        args,
      };
    });

    const [first, second] = await Promise.all([
      claimMutation('tenant-1', 'same-effect', 'tool-a'),
      claimMutation('tenant-1', 'same-effect', 'tool-a'),
    ]);

    expect(first).toEqual({ kind: 'execute', token: 'token-a' });
    expect(second).toEqual({ kind: 'busy' });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
  });

  it('usa RPCs fenced para renovar, completar y fallar sin enviar fechas de aplicación', async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await renewMutation('tenant-1', 'effect-1', 'token-db');
    await completeMutation('tenant-1', 'effect-1', 'token-db', { saved: true });
    await failMutation('tenant-1', 'effect-1', 'token-db', 'fallo');

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'renew_agente_mutacion',
      'complete_agente_mutacion',
      'fail_agente_mutacion',
    ]);
    for (const [, args] of rpc.mock.calls) {
      expect(args).not.toHaveProperty('lease_until');
      expect(args).not.toHaveProperty('updated_at');
    }
  });
});
