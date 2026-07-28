import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el ciclo de tools no miraba `finish_reason`.
//
// Cien líneas más arriba, `generateStructured` detecta `finish_reason:'length'`
// ANTES de parsear, lanza TruncatedError y reintenta con el doble de techo. El
// comentario de DEFAULT_MAX_TOKENS explica por qué: Gemini gasta 1,000-1,800
// tokens de razonamiento invisible antes de escribir la primera llave.
//
// El ciclo de tools no aprendió nada de eso: `max_tokens: opts.maxTokens ?? 1000`
// para el rol `cuadre`, que corre con `reasoning: 'high'`. Mil tokens de techo
// COMPARTIDOS entre el razonamiento y la respuesta.
//
// El caso peligroso no es el texto cortado, es el VACÍO: con finalText '' y cero
// tools, processor.ts hacía `res.finalText || 'Listo. 👍'` y el chofer recibía una
// confirmación afirmativa de un turno donde no se cuadró nada, no se cerró la
// liquidación y no se generó ningún PDF. Se pagó la llamada. Nadie ve un error.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools, TruncatedError, PartialExecutionError } = await import('./openrouter');

const cortada = (content: string | null) => ({
  choices: [{ message: { content, tool_calls: [] }, finish_reason: 'length' }],
  usage: { prompt_tokens: 900, completion_tokens: 1000 }, model: 'm',
});
const completa = (content: string) => ({
  choices: [{ message: { content, tool_calls: [] }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});

const correr = () => generateWithTools({
  role: 'cuadre', system: 's', messages: [{ role: 'user', content: 'listo, ya no tengo más' }],
  tools: [{ type: 'function', function: { name: 'cuadrar_viaje', description: 'd', parameters: { type: 'object', properties: {} } } }],
  toolExecutor: async () => ({ success: true, result: { ok: 1 }, durationMs: 1 }),
  reasoning: 'high',
});

describe('una respuesta cortada no se puede tratar como completa', () => {
  beforeEach(() => { create.mockReset(); });

  it('el techo del ciclo de tools ya no es 1000: el razonamiento no cabía', async () => {
    create.mockResolvedValueOnce(completa('listo'));
    await correr();
    expect(create.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(4000);
  });

  // El ciclo envuelve TODO en PartialExecutionError —con lo ya ejecutado, los
  // tokens y el costo— para que el processor pueda cerrar fail-closed sin perder
  // la contabilidad. Lo que importa es que el turno NO salga como bueno, y que la
  // causa siga siendo diagnosticable.
  it('finish_reason "length" con texto a medias NO se envía como respuesta', async () => {
    create.mockResolvedValue(cortada('Tu viaje quedó con una diferencia de $1,2'));
    const err = await correr().catch((e) => e);
    expect(err).toBeInstanceOf(PartialExecutionError);
    expect(err.cause).toBeInstanceOf(TruncatedError);
  });

  it('finish_reason "length" con content vacío tampoco pasa como turno bueno', async () => {
    create.mockResolvedValue(cortada(null));
    const err = await correr().catch((e) => e);
    expect(err).toBeInstanceOf(PartialExecutionError);
    expect(err.cause).toBeInstanceOf(TruncatedError);
  });

  it('una respuesta normal sigue saliendo igual (regresión)', async () => {
    create.mockResolvedValueOnce(completa('Listo, cuadré tu viaje'));
    const r = await correr();
    expect(r.finalText).toBe('Listo, cuadré tu viaje');
  });
});
