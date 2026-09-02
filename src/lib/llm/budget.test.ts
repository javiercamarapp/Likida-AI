import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (query: unknown) => query }));

const { createLlmBudget, reserveLlmBudget, settleLlmBudget, LlmBudgetExceededError, requireLlmBudgetTenant } = await import('./budget');

describe('presupuesto monetario duro del runtime', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 'ok', error: null }); vi.unstubAllEnvs(); });

  it('reserva antes de gastar y liquida al costo real', async () => {
    const budget = createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000001', 'interactivo');
    const reservation = await reserveLlmBudget(budget, 0.10);
    expect(rpc).toHaveBeenCalledWith('reservar_presupuesto_llm', expect.objectContaining({ p_tenant_id: 'tenant-1', p_reserva_usd: 0.1, p_tope_run_usd: 0.5 }));
    await settleLlmBudget(budget, reservation, 0.02);
    expect(rpc).toHaveBeenLastCalledWith('liquidar_presupuesto_llm', expect.objectContaining({ p_costo_real_usd: 0.02 }));
    expect(budget.reservadoRunUsd).toBeCloseTo(0.02);
  });

  it('rechaza localmente una reserva que excede el techo del run', async () => {
    vi.stubEnv('LIKIDA_LLM_RUN_BUDGET_USD', '0.10');
    const budget = createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000002', 'interactivo');
    await expect(reserveLlmBudget(budget, 0.11)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('frena si la reserva atómica del tenant devuelve tope_tenant', async () => {
    rpc.mockResolvedValueOnce({ data: 'tope_tenant', error: null });
    const budget = createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000003', 'interactivo');
    await expect(reserveLlmBudget(budget, 0.01)).rejects.toMatchObject({ scope: 'tenant' });
    expect(budget.reservadoRunUsd).toBe(0);
  });

  it('requiere tenant explícito; nunca cae a una variable global', () => {
    expect(() => createLlmBudget(undefined, '00000000-0000-4000-8000-000000000004', 'interactivo')).toThrow(/tenant requerido/);
    expect(() => createLlmBudget(null, '00000000-0000-4000-8000-000000000005', 'interactivo')).toThrow(/tenant requerido/);
  });

  it('mantiene aislamiento: dos tenants usan reservas y topes independientes', async () => {
    const a = createLlmBudget('tenant-a', '00000000-0000-4000-8000-000000000006', 'interactivo');
    const b = createLlmBudget('tenant-b', '00000000-0000-4000-8000-000000000007', 'interactivo');
    await reserveLlmBudget(a, 0.10);
    await reserveLlmBudget(b, 0.20);
    expect(rpc.mock.calls.map(([, args]) => args)).toEqual([
      expect.objectContaining({ p_tenant_id: 'tenant-a', p_run_id: a.runId }),
      expect.objectContaining({ p_tenant_id: 'tenant-b', p_run_id: b.runId }),
    ]);
  });

  it('liquidar es idempotente en el proceso: un retry no duplica el commit', async () => {
    const budget = createLlmBudget('tenant-retry', '00000000-0000-4000-8000-000000000008', 'interactivo');
    const reservation = await reserveLlmBudget(budget, 0.10);
    await settleLlmBudget(budget, reservation, 0.04);
    await settleLlmBudget(budget, reservation, 0.04);
    expect(rpc.mock.calls.filter(([name]) => name === 'liquidar_presupuesto_llm')).toHaveLength(1);
  });
});

describe('D.23 — el presupuesto tiene dimensión de propósito y una reserva para el camino interactivo', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 'ok', error: null }); vi.unstubAllEnvs(); });

  it('la reserva viaja con propósito y con la reserva interactiva calculada del techo diario', async () => {
    vi.stubEnv('LIKIDA_LLM_TENANT_DAILY_BUDGET_USD', '10');
    vi.stubEnv('LIKIDA_LLM_RESERVA_INTERACTIVO_PCT', '0.3');
    const budget = createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000010', 'ocr_lote');
    await reserveLlmBudget(budget, 0.10);
    expect(rpc).toHaveBeenCalledWith('reservar_presupuesto_llm', expect.objectContaining({
      p_proposito: 'ocr_lote',
      p_reserva_interactivo_usd: 3,
    }));
  });

  it('tope_proposito falla cerrado con scope proposito y el mensaje en español dice de quién es la reserva', async () => {
    rpc.mockResolvedValueOnce({ data: 'tope_proposito', error: null });
    const budget = createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000011', 'ocr_lote');
    const err = await reserveLlmBudget(budget, 0.05).then(() => null, (e) => e as Error);
    expect(err).toBeInstanceOf(LlmBudgetExceededError);
    expect((err as InstanceType<typeof LlmBudgetExceededError>).scope).toBe('proposito');
    expect(err!.message).toMatch(/camino interactivo/);
    expect(budget.reservadoRunUsd).toBe(0);   // nada quedó cobrado
  });

  it('tope_run desde la base también se distingue', async () => {
    rpc.mockResolvedValueOnce({ data: 'tope_run', error: null });
    const budget = createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000012', 'interactivo');
    await expect(reserveLlmBudget(budget, 0.05)).rejects.toMatchObject({ scope: 'run' });
  });

  it('un propósito fuera del dominio se rechaza ANTES de gastar', () => {
    expect(() => createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000013', 'marketing' as never))
      .toThrow(/propósito desconocido/);
  });

  it('una respuesta fuera del contrato (el true de la RPC vieja) LANZA — jamás se trata como éxito', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const budget = createLlmBudget('tenant-1', '00000000-0000-4000-8000-000000000014', 'interactivo');
    await expect(reserveLlmBudget(budget, 0.05)).rejects.toThrow(/0244/);
    expect(budget.reservadoRunUsd).toBe(0);
  });
});

describe('requireLlmBudgetTenant en NODE_ENV=production', () => {
  // Regresión de producción, 25-ago-2026: el regex exigía los nibbles de
  // versión/variante RFC4122 ([1-5].../[89ab]...), y `tenant.id` de G3M —la
  // ÚNICA flota en producción— es `11111111-1111-1111-1111-111111111111`, un
  // UUID a propósito (`seed.sql`) que no los trae. Con `NODE_ENV=production`
  // TODA llamada al agente para G3M lanzaba "tenant inválido" y el operador
  // recibía el genérico "se me trabó el sistema" — confirmado contra el log
  // real de `agent.fail` en producción. Ningún test hasta hoy corría esta
  // rama: los de arriba usan tenants como `'tenant-1'`, que ni siquiera
  // entran al regex porque nada fuerza `NODE_ENV=production` en la suite.
  beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); });

  it('acepta el UUID real de G3M, la flota en producción', () => {
    expect(requireLlmBudgetTenant('11111111-1111-1111-1111-111111111111')).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('acepta cualquier forma 8-4-4-4-12 en hex, sin exigir versión/variante RFC4122', () => {
    expect(requireLlmBudgetTenant('00000000-0000-0000-0000-000000000000')).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('sigue rechazando lo que no tiene forma de UUID', () => {
    expect(() => requireLlmBudgetTenant('tenant-1')).toThrow(/tenant inválido/);
    expect(() => requireLlmBudgetTenant('11111111-1111-1111-1111-11111111111g')).toThrow(/tenant inválido/);
  });

  it('sigue rechazando vacío o null antes de llegar al regex', () => {
    expect(() => requireLlmBudgetTenant('')).toThrow(/tenant requerido/);
    expect(() => requireLlmBudgetTenant(null)).toThrow(/tenant requerido/);
  });
});
