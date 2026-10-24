// A37-L-11: el respaldo del cuadre (otro modelo, sin medir en política fiscal)
// NO dispone de herramientas que escriben (guardar_liquidacion): solo lectura/cuadre.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
process.env.OPENROUTER_API_KEY = 'test-key';
delete process.env.LIKIDA_MODEL_CUADRE;

const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object', properties: {} } } });
const TOOLS = [tool('consultar_politica'), tool('cuadrar_viaje'), tool('guardar_liquidacion'), tool('estado_viaje')];
const ok = (model: string, content = 'listo') => ({
  model, choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
});
const caido = () => Object.assign(new Error('503 upstream'), { status: 503 });
const nombresDe = (llamada: number) =>
  ((create.mock.calls[llamada][0] as { tools?: Array<{ function: { name: string } }> }).tools ?? []).map((t) => t.function.name);

const correr = async (role: 'cuadre' | 'chat') => {
  const { generateWithTools } = await import('./openrouter');
  return generateWithTools({
    role, system: 'SIS', messages: [{ role: 'user', content: 'cierra' }],
    tools: TOOLS, toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
  });
};

beforeEach(() => { create.mockReset(); });

describe('A37-L-11 · el respaldo del cuadre no recibe herramientas que escriben', () => {
  it('con el primario caído, la llamada al respaldo omite guardar_liquidacion y avisa que el cierre queda pendiente', async () => {
    create.mockRejectedValueOnce(caido()).mockResolvedValueOnce(ok('openai/gpt-5.6-terra'));
    const r = await correr('cuadre');
    expect(r.model).toBe('openai/gpt-5.6-terra');
    const ultima = create.mock.calls.length - 1;
    expect(nombresDe(0)).toContain('guardar_liquidacion');
    expect(nombresDe(ultima)).not.toContain('guardar_liquidacion');
    expect(nombresDe(ultima)).toEqual(expect.arrayContaining(['consultar_politica', 'cuadrar_viaje', 'estado_viaje']));
    const mensajes = (create.mock.calls[ultima][0] as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(JSON.stringify(mensajes)).toMatch(/respaldo/i);
  });

  it('los demás roles conservan todas sus herramientas en el respaldo', async () => {
    create.mockRejectedValueOnce(caido()).mockResolvedValueOnce(ok('x'));
    await correr('chat');
    expect(nombresDe(create.mock.calls.length - 1)).toContain('guardar_liquidacion');
  });
});
