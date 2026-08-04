import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA CACHÉ DE PROMPT DEL CUADRE — la única optimización que no toca la calidad.
//
// MEDIDO el 4-ago-2026 sobre las 4 liquidaciones reales de la base: el ciclo de
// herramientas NO gasta un número fijo de llamadas, escala con los comprobantes
// (2, 4, 8 y 10 vueltas), y la entrada crece con la conversación hasta 21,224
// tokens. La de 21 comprobantes reenvía ~72,000 tokens de entrada — y el system
// prompt con las reglas fiscales viaja idéntico en todas las vueltas.
//
// Anthropic cobra la lectura de caché al 10% de la entrada. Marcar el prefijo
// estable NO cambia el modelo, ni el prompt, ni la salida: mismo Sonnet, misma
// respuesta. Por eso es la palanca correcta para el cuadre, donde un error
// cuesta dinero de verdad y bajar de modelo no está sobre la mesa.
// ═══════════════════════════════════════════════════════════════════════════

const crear = vi.fn();
vi.mock('./models', () => ({ modelFor: (r: string) => (r === 'cuadre' ? 'anthropic/claude-sonnet-5' : 'google/gemini-3.1-flash-lite') }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => crear(...a) } }; },
}));

const { generateWithTools } = await import('./openrouter');

function respuesta(texto: string) {
  return {
    model: 'anthropic/claude-sonnet-5',
    choices: [{ message: { role: 'assistant', content: texto, tool_calls: undefined }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 8000, completion_tokens: 300 },
  };
}

describe('caché de prompt en el ciclo de herramientas', () => {
  beforeEach(() => { crear.mockReset(); process.env.OPENROUTER_API_KEY = 'x'; });

  it('marca el SYSTEM del cuadre para caché — es el bloque grande e invariante', async () => {
    crear.mockResolvedValue(respuesta('listo'));
    await generateWithTools({
      role: 'cuadre',
      system: 'REGLAS FISCALES LARGAS…',
      messages: [{ role: 'user', content: 'cuadra el viaje' }],
      tools: [], toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
    });

    const cuerpo = crear.mock.calls[0][0] as { messages: Array<Record<string, unknown>> };
    const sys = cuerpo.messages[0];
    expect(sys.role).toBe('system');
    // El contenido va como bloque con el breakpoint, no como string suelto.
    const bloques = sys.content as Array<Record<string, unknown>>;
    expect(Array.isArray(bloques)).toBe(true);
    expect(bloques[0].text).toBe('REGLAS FISCALES LARGAS…');
    expect(bloques[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('NO marca los mensajes que cambian entre vueltas', async () => {
    crear.mockResolvedValue(respuesta('listo'));
    await generateWithTools({
      role: 'cuadre', system: 'S',
      messages: [{ role: 'user', content: 'cuadra' }],
      tools: [], toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
    });
    const cuerpo = crear.mock.calls[0][0] as { messages: Array<Record<string, unknown>> };
    // Marcar un bloque que cambia invalida la caché en cada vuelta: sería pagar
    // la escritura (más cara) sin llegar nunca a leerla.
    expect(JSON.stringify(cuerpo.messages[1])).not.toContain('cache_control');
  });

  it('con un modelo que no es de Anthropic NO manda cache_control', async () => {
    crear.mockResolvedValue({ ...respuesta('ok'), model: 'google/gemini-3.1-flash-lite' });
    await generateWithTools({
      role: 'chat', system: 'S',
      messages: [{ role: 'user', content: 'hola' }],
      tools: [], toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
    });
    const cuerpo = crear.mock.calls[0][0] as { messages: Array<Record<string, unknown>> };
    expect(typeof cuerpo.messages[0].content).toBe('string');
    expect(JSON.stringify(cuerpo.messages[0])).not.toContain('cache_control');
  });
});
