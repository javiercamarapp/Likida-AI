import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · M28 — el costo de la primera vuelta desaparecía si el
// reintento correctivo tronaba. La primera llamada a generateWithTools
// RESUELVE (ya se pagó), la guardia la tumba, el segundo ciclo pega el
// loop-guard → PartialExecutionError con el gasto SOLO del segundo. El route
// registra eso como 'parcial' y la primera vuelta nunca llega a llm_costo:
// el tope diario de $1/tenant subcontaba más de la mitad.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en pruebas'); } }));

const { PartialExecutionError } = await import('@/lib/llm/openrouter');

let llamada = 0;
const generateWithTools = vi.fn(async (_o: unknown) => {
  llamada++;
  if (llamada === 1) {
    // Resuelve con una cifra que ninguna tool respalda → reintento.
    return {
      toolCalls: [{ toolName: 'kpis_flota', result: { gasto: 100 }, durationMs: 1 }],
      finalText: 'Gastaste 987654 pesos.',
      cost: 0.014, tokensIn: 40_000, tokensOut: 900, model: 'flash',
      costoPorModelo: { flash: { tokensIn: 40_000, tokensOut: 900, cost: 0.014 } },
    };
  }
  throw new PartialExecutionError('Ciclo de tools excedió 4 rondas', null, [], 30_000, 700, 0.011);
});
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, generateWithTools: (...a: unknown[]) => generateWithTools(...(a as [never])) };
});

const { ejecutarAnalista } = await import('./analista');

describe('M28 — el reintento que truena arrastra lo que la primera vuelta ya pagó', () => {
  it('el PartialExecutionError que sube trae tokens y costo de LAS DOS vueltas', async () => {
    const err = await ejecutarAnalista({
      tenantId: 't-1', nombreFlota: 'Flota', usuario: { nombre: 'Ana', rol: 'flota_admin' },
      mensajes: [{ rol: 'usuario', texto: '¿cuánto gasté?' }],
    }).catch((e) => e);

    expect(generateWithTools).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(PartialExecutionError);
    expect(err.cost).toBeCloseTo(0.025, 6);
    expect(err.tokensIn).toBe(70_000);
    expect(err.tokensOut).toBe(1_600);
    // Y las tools de la primera vuelta viajan para el diagnóstico.
    expect(err.partialToolCalls.map((t: { toolName: string }) => t.toolName)).toContain('kpis_flota');
  });
});
