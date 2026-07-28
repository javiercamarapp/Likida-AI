import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — la caché de lectura guardaba también los FRACASOS.
//
// REGRESIÓN del arreglo de la ronda 3: para que `cuadrar_viaje` dejara de
// repetir el barrido del ejercicio se metió `cuadrar_` en READ_PREFIXES. Pero
// `crossRound.set(key, exec)` guardaba el resultado sin mirar `exec.success`,
// así que el fracaso pasó a ser PERMANENTE dentro del turno.
//
// La rejilla hermana de mutaciones (`tool-executor.ts:82`) sí distingue, y lo
// dice por escrito: "Solo se cachea el éxito (un fallo sí puede reintentarse)".
//
// El caso real: un blip de Supabase de un segundo en la ronda 1. El modelo
// reintenta —lo natural viendo un error— y se le sirven tres veces el mismo
// error desde memoria, sin volver a preguntarle a una base que ya está sana.
// Un fallo de red que se cura solo se convierte en un "listo" perdido y en una
// disculpa delante del comprador.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools } = await import('./openrouter');

const pideTool = () => ({
  choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'cuadrar_viaje', arguments: '{}' } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});
const final = () => ({
  choices: [{ message: { content: 'listo', tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});

const correr = (toolExecutor: (n: string, a: Record<string, unknown>) => Promise<{ success: boolean; result: unknown; durationMs: number; error?: string }>) =>
  generateWithTools({
    role: 'chat', system: 's', messages: [{ role: 'user', content: 'listo' }],
    tools: [{ type: 'function', function: { name: 'cuadrar_viaje', description: 'd', parameters: { type: 'object', properties: {} } } }],
    toolExecutor,
  });

describe('la caché entre rondas no puede convertir un fallo transitorio en permanente', () => {
  beforeEach(() => { create.mockReset(); });

  it('si la tool de lectura FALLA, la ronda siguiente vuelve a ejecutarla', async () => {
    create.mockResolvedValueOnce(pideTool()).mockResolvedValueOnce(pideTool()).mockResolvedValueOnce(final());
    let n = 0;
    const exec = vi.fn(async () => {
      n += 1;
      // Blip de Supabase en la ronda 1; en la ronda 2 la base ya está sana.
      return n === 1
        ? { success: false, result: null, durationMs: 1, error: 'fetch failed' }
        : { success: true, result: { total: 5000 }, durationMs: 1 };
    });

    const r = await correr(exec);

    // Sin el arreglo esto es 1: el error se sirve desde memoria y nadie vuelve
    // a preguntarle a la base.
    expect(exec).toHaveBeenCalledTimes(2);
    // Y el segundo intento tiene que llegar SIN error, que es lo que permite
    // que `guardiaCifras` considere que hubo cuadre (exige `!t.error`).
    expect(r.toolCalls.at(-1)?.error).toBeUndefined();
    expect(r.toolCalls.at(-1)?.result).toEqual({ total: 5000 });
  });

  it('el ÉXITO sí se sigue cacheando: esa era la razón del arreglo de la ronda 3', async () => {
    create.mockResolvedValueOnce(pideTool()).mockResolvedValueOnce(pideTool()).mockResolvedValueOnce(final());
    const exec = vi.fn(async () => ({ success: true, result: { total: 5000 }, durationMs: 1 }));

    await correr(exec);

    // Dos llamadas del modelo, UNA ejecución: el barrido del ejercicio no se
    // repite. Si esto se rompe, volvió el hallazgo de rendimiento de la ronda 3.
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
