import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA prod 25-ago-2026, CRÍTICO — `generateWithTools` perdía el `this`
// del método `create`.
//
// El SDK real de OpenAI guarda su cliente en `this._client` dentro de cada
// `APIResource` (`chat.completions` es uno) y lo usa para hacer la petición
// HTTP. `generateWithTools` extraía `client.chat.completions.create` a una
// variable suelta y la llamaba como función standalone — en modo estricto
// (todo este repo es ESM) eso deja `this` en `undefined` dentro del método, y
// el SDK revienta con "Cannot read properties of undefined (reading
// '_client')" DESPUÉS de reservar presupuesto y ANTES de tocar la red.
//
// TODOS los demás tests de este archivo mockean el cliente con una propiedad
// de tipo arrow function (`create: (...a) => fn(...a)`), que no tiene `this`
// propio — así que destructurarla no pierde nada y el bug queda invisible.
// Este test usa un MÉTODO de verdad (sintaxis de método de clase, con `this`
// real) para que perder el `this` SÍ reviente, igual que el SDK real.
// ═══════════════════════════════════════════════════════════════════════════

class FakeCompletions {
  respuesta: unknown;
  // Método de verdad: depende de `this` para funcionar, como `APIResource`
  // del SDK real. Llamarlo desligado de `this === completions` debe lanzar,
  // exactamente como el SDK real lanza leyendo `this._client`.
  create() {
    if (this !== completions) {
      throw new TypeError("Cannot read properties of undefined (reading '_client')");
    }
    return Promise.resolve(this.respuesta);
  }
}
const completions = new FakeCompletions();

vi.mock('openai', () => ({
  default: class { chat = { completions }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools } = await import('./openrouter');

function respuestaOk(texto: string) {
  return {
    model: 'anthropic/claude-sonnet-5',
    choices: [{ message: { role: 'assistant', content: texto, tool_calls: undefined }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

describe('generateWithTools llama a create() con el `this` correcto', () => {
  it('un "Hola" normal no revienta por perder el this del método del SDK', async () => {
    completions.respuesta = respuestaOk('¡Hola! ¿En qué te ayudo?');
    const r = await generateWithTools({
      role: 'chat',
      system: 'S',
      messages: [{ role: 'user', content: 'Hola' }],
      tools: [],
      toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
    });
    expect(r.finalText).toBe('¡Hola! ¿En qué te ayudo?');
  });
});
