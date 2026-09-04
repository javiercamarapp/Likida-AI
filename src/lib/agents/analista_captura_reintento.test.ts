import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 (ALTO, tool-calling.md:87) — `CAPTURAS` es el canal lateral
// por el que `entregar_respuesta` le pasa los bloques al orquestador
// (`analista.ts:243`, llaveado por `runId`). El reintento correctivo corre
// DENTRO del mismo turno y con el MISMO `runId`. Antes de este arreglo, si
// el segundo ciclo no volvía a llamar la tool terminal —el modo de falla que
// dispara el reintento es justo ese: "flash-lite a veces contesta en texto
// plano sin la tool terminal"—, `CAPTURAS.get(runId)` seguía trayendo los
// bloques del PRIMER ciclo, los que la guardia acababa de rechazar, y la
// respuesta REAL del segundo ciclo (su `finalText`) quedaba inalcanzable
// detrás del `??`.
//
// Este archivo es distinto de `analista_costo_reintento.test.ts`: ahí
// `generateWithTools` está mockeado por completo y NUNCA llama a
// `opts.toolExecutor`, así que el handler registrado de `entregar_respuesta`
// —y por tanto `CAPTURAS`— nunca corre. Aquí el mock SÍ invoca
// `opts.toolExecutor('entregar_respuesta', …)`, ejercitando el handler REAL
// (`registerTool`, el mismo REGISTRY de `tool-executor.ts`) y su canal
// lateral, que es exactamente lo que el hallazgo dice sin cobertura.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en pruebas'); } }));

const generateWithTools = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, generateWithTools: (...a: unknown[]) => generateWithTools(...(a as [never])) };
});

const { ejecutarAnalista } = await import('./analista');

type ToolExecutorLike = (name: string, args: Record<string, unknown>) => Promise<{ result: unknown; error?: string; durationMs: number }>;

describe('CAPTURAS no fuga del primer ciclo al segundo — el reintento no hereda la entrega rechazada', () => {
  it('EL HALLAZGO: si el 2º ciclo NO vuelve a llamar entregar_respuesta, su finalText —no los bloques viejos— es lo que se evalúa', async () => {
    generateWithTools.mockReset();
    // Ronda 1: SÍ llama entregar_respuesta, con una cifra que NINGUNA tool
    // respalda — la guardia la va a rechazar y dispara el reintento.
    generateWithTools.mockImplementationOnce(async (opts: { toolExecutor: ToolExecutorLike }) => {
      const r = await opts.toolExecutor('entregar_respuesta', {
        bloques: [{ tipo: 'cifra', valor: 87654.32, formato: 'mxn' }],
      });
      return {
        finalText: '', toolCalls: [{ toolName: 'entregar_respuesta', args: {}, result: r.result, error: r.error, durationMs: r.durationMs }],
        model: 'flash', tokensIn: 100, tokensOut: 50, cost: 0.001, costoPorModelo: {},
      };
    });
    // Ronda 2 (el reintento correctivo): el modo de falla real — contesta en
    // texto plano, SIN volver a llamar la tool terminal. Trae una tool de
    // lectura que SÍ respalda la cifra correcta.
    generateWithTools.mockImplementationOnce(async () => ({
      finalText: 'El gasto en diésel del mes fue $48,000.00.',
      toolCalls: [{ toolName: 'kpis_flota', args: {}, result: { gastoDiesel: 48000 }, durationMs: 1 }],
      model: 'flash', tokensIn: 100, tokensOut: 50, cost: 0.001, costoPorModelo: {},
    }));

    const res = await ejecutarAnalista({
      tenantId: 't-1', nombreFlota: 'Flota', usuario: { nombre: 'Ana', rol: 'flota_admin' },
      mensajes: [{ rol: 'usuario', texto: '¿cuánto gasté en diésel este mes?' }],
    });

    expect(generateWithTools).toHaveBeenCalledTimes(2);
    // La respuesta REAL del segundo ciclo es la que se entrega — respaldada
    // por su propia tool (48000), no la cifra vieja (87654.32) que la
    // guardia ya había rechazado en la primera vuelta.
    expect(res.bloques).toEqual([{ tipo: 'texto', texto: 'El gasto en diésel del mes fue $48,000.00.' }]);
    expect(JSON.stringify(res.bloques)).not.toContain('87654.32');
  });

  it('si el 2º ciclo SÍ vuelve a llamar entregar_respuesta, esa entrega manda (y no la del primero)', async () => {
    generateWithTools.mockReset();
    generateWithTools.mockImplementationOnce(async (opts: { toolExecutor: ToolExecutorLike }) => {
      const r = await opts.toolExecutor('entregar_respuesta', { bloques: [{ tipo: 'cifra', valor: 87654.32, formato: 'mxn' }] });
      return {
        finalText: '', toolCalls: [{ toolName: 'entregar_respuesta', args: {}, result: r.result, error: r.error, durationMs: r.durationMs }],
        model: 'flash', tokensIn: 100, tokensOut: 50, cost: 0.001, costoPorModelo: {},
      };
    });
    generateWithTools.mockImplementationOnce(async (opts: { toolExecutor: ToolExecutorLike }) => {
      // Esta vez SÍ entrega por la tool, con la cifra correcta y respaldada.
      const r = await opts.toolExecutor('entregar_respuesta', { bloques: [{ tipo: 'cifra', valor: 48000, formato: 'mxn' }] });
      return {
        finalText: '',
        toolCalls: [
          { toolName: 'kpis_flota', args: {}, result: { gastoDiesel: 48000 }, durationMs: 1 },
          { toolName: 'entregar_respuesta', args: {}, result: r.result, error: r.error, durationMs: r.durationMs },
        ],
        model: 'flash', tokensIn: 100, tokensOut: 50, cost: 0.001, costoPorModelo: {},
      };
    });

    const res = await ejecutarAnalista({
      tenantId: 't-1', nombreFlota: 'Flota', usuario: { nombre: 'Ana', rol: 'flota_admin' },
      mensajes: [{ rol: 'usuario', texto: '¿cuánto gasté en diésel este mes?' }],
    });

    expect(res.bloques).toEqual([{ tipo: 'cifra', valor: 48000, formato: 'mxn' }]);
  });
});
