import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 (ALTO, tool-calling.md:87) — mismo arreglo que
// `analista_captura_reintento.test.ts`, espejado para el copiloto:
// `CAPTURAS` (el canal lateral de `entregar_respuesta_admin`) se llavea por
// `runId`, y el reintento corre con el MISMO `runId`. `copiloto.test.ts` no
// cubre este camino porque su mock de `generateWithTools` nunca invoca
// `opts.toolExecutor` — aquí sí, ejercitando el handler REAL registrado.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en pruebas'); } }));

const generateWithTools = vi.fn();
vi.mock('@/lib/llm/openrouter', () => ({
  generateWithTools: (...a: unknown[]) => generateWithTools(...(a as [never])),
}));

const { ejecutarCopiloto } = await import('./copiloto');

type ToolExecutorLike = (name: string, args: Record<string, unknown>) => Promise<{ result: unknown; error?: string; durationMs: number }>;

describe('copiloto — CAPTURAS no fuga del primer ciclo al segundo', () => {
  it('EL HALLAZGO: si el 2º ciclo NO vuelve a llamar entregar_respuesta_admin, su finalText —no los bloques viejos— es lo que se evalúa', async () => {
    generateWithTools.mockReset();
    generateWithTools.mockImplementationOnce(async (opts: { toolExecutor: ToolExecutorLike }) => {
      const r = await opts.toolExecutor('entregar_respuesta_admin', {
        bloques: [{ tipo: 'cifra', valor: 87654.32, formato: 'mxn' }],
      });
      return {
        finalText: '', toolCalls: [{ toolName: 'entregar_respuesta_admin', args: {}, result: r.result, error: r.error, durationMs: r.durationMs }],
        model: 'flash', tokensIn: 100, tokensOut: 50, cost: 0.001, costoPorModelo: {},
      };
    });
    generateWithTools.mockImplementationOnce(async () => ({
      finalText: 'El costo de IA del mes va en $48,000.00.',
      toolCalls: [{ toolName: 'metrica_negocio', args: {}, result: { costoIaUsd: 48000 }, durationMs: 1 }],
      model: 'flash', tokensIn: 100, tokensOut: 50, cost: 0.001, costoPorModelo: {},
    }));

    const r = await ejecutarCopiloto({
      userId: 'u-1', budgetTenantId: 'tenant-test-a',
      mensajes: [{ rol: 'usuario', texto: '¿cuánto llevamos de costo de IA?' }],
    });

    expect(generateWithTools).toHaveBeenCalledTimes(2);
    expect(r.bloques).toEqual([{ tipo: 'texto', texto: 'El costo de IA del mes va en $48,000.00.' }]);
    expect(JSON.stringify(r.bloques)).not.toContain('87654.32');
  });
});
