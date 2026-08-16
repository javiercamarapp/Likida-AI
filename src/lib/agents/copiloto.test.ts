import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR DEL COPILOTO — lo que se fija aquí es la CADENA de guardias en
// el camino nuevo (la guardia misma ya tiene sus pruebas en analista):
//
//  1. Una respuesta con una cifra que NINGUNA tool devolvió se tumba, y la
//     red final entrega la tabla determinista con lo que las tools SÍ
//     leyeron — jamás la cifra inventada.
//  2. La acción propuesta sobrevive con su previsualización DEL CATÁLOGO
//     (no del modelo) anexada al final de los bloques.
// ═══════════════════════════════════════════════════════════════════════════

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger: logs }));
// Las tools 🟢 tocan lib/admin (supabaseAdmin al importar): dobles vacíos —
// aquí no se ejecuta ninguna tool real, el ciclo entero se simula en
// generateWithTools.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en pruebas'); } }));

/** Cada llamada a generateWithTools consume el siguiente guion. */
type ToolCall = { toolName: string; result: unknown; error?: string | null };
let guiones: Array<{ toolCalls: ToolCall[]; finalText: string }>;
const generateWithTools = vi.fn(async (opts: { toolExecutor?: unknown }) => {
  void opts;
  const g = guiones.shift() ?? { toolCalls: [], finalText: '' };
  return {
    toolCalls: g.toolCalls,
    finalText: g.finalText,
    cost: 0.001, tokensIn: 100, tokensOut: 50, model: 'prueba',
    costoPorModelo: { prueba: { tokensIn: 100, tokensOut: 50, cost: 0.001 } },
  };
});
vi.mock('@/lib/llm/openrouter', () => ({
  generateWithTools: (...a: unknown[]) => generateWithTools(...(a as [never])),
}));

const { ejecutarCopiloto } = await import('./copiloto');

beforeEach(() => {
  guiones = [];
  logs.warn.mockClear();
});

describe('la guardia de cifras en el camino del copiloto', () => {
  it('una cifra que ninguna tool devolvió SE TUMBA, y la red final entrega lo que las tools sí leyeron', async () => {
    const llamada = {
      toolCalls: [{ toolName: 'bandeja', result: { conteos: { arco: 2 }, enCola: 2 }, error: null }],
      // 3847 no vino de ninguna tool: es la invención que la guardia existe
      // para no dejar pasar (y no es derivable de {2} ni del calendario).
      finalText: 'Tienes 3847 asuntos pendientes en la bandeja.',
    };
    guiones = [llamada, llamada]; // el turno + su reintento correctivo, ambos inventando
    const r = await ejecutarCopiloto({ userId: 'u-1', mensajes: [{ rol: 'usuario', texto: '¿qué espera decisión hoy?' }] });

    const todoElTexto = JSON.stringify(r.bloques);
    expect(todoElTexto).not.toContain('3847');
    // La red final: la tabla determinista con el resultado real de la tool.
    expect(r.bloques.some((b) => b.tipo === 'tabla')).toBe(true);
    expect(logs.warn).toHaveBeenCalledWith('copiloto.reintento_correctivo', expect.anything());
  });

  it('con las tools mudas y el texto inventando, sale el aviso honesto — nunca el número', async () => {
    const llamada = { toolCalls: [], finalText: 'El MRR es de $840,000.' };
    guiones = [llamada, llamada];
    const r = await ejecutarCopiloto({ userId: 'u-1', mensajes: [{ rol: 'usuario', texto: '¿cómo vamos?' }] });
    const texto = JSON.stringify(r.bloques);
    expect(texto).not.toContain('840');
    expect(texto).toMatch(/no pude armar esa respuesta/i);
  });

  it('una cifra QUE SÍ devolvió una tool pasa entera', async () => {
    guiones = [{
      toolCalls: [{ toolName: 'metrica_negocio', result: { flotas: 4, costoIaUsd: 123.45 }, error: null }],
      finalText: 'Tienes 4 flotas dadas de alta y el costo de IA va en 123.45 USD.',
    }];
    const r = await ejecutarCopiloto({ userId: 'u-1', mensajes: [{ rol: 'usuario', texto: '¿cómo va el negocio?' }] });
    expect(JSON.stringify(r.bloques)).toContain('123.45');
  });
});
