import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA CACHÉ DE PROMPT EN `generateResponse` — la misma palanca que el ciclo de
// herramientas (cache_prompt.test.ts), extendida al chat simple.
//
// El llamador que la exige es el CONTADOR (E.26): manda el corpus normativo
// completo (~45k tokens) idéntico en cada una de sus 32 preguntas doradas.
// Sin el breakpoint en el SYSTEM, el examen re-paga el corpus entero 32
// veces; con él, Anthropic cobra la lectura al 10% y la corrida completa
// queda en el orden de lo presupuestado en 22-evaluacion.md.
// ═══════════════════════════════════════════════════════════════════════════

const crear = vi.fn();
vi.mock('./models', () => ({
  modelFor: (r: string) => (r === 'contador' ? 'anthropic/claude-sonnet-5' : 'google/gemini-3.5-flash-lite'),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => crear(...a) } }; },
}));

const { generateResponse } = await import('./openrouter');

function respuesta(modelo: string) {
  return {
    model: modelo,
    choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 45000, completion_tokens: 300 },
  };
}

describe('caché de prompt en generateResponse', () => {
  beforeEach(() => { crear.mockReset(); process.env.OPENROUTER_API_KEY = 'x'; });

  it('marca el SYSTEM para caché cuando el modelo es de Anthropic (el contador)', async () => {
    crear.mockResolvedValue(respuesta('anthropic/claude-sonnet-5'));
    await generateResponse({
      role: 'contador',
      system: 'CORPUS NORMATIVO COMPLETO…',
      messages: [{ role: 'user', content: '¿Q1?' }],
    });
    const cuerpo = crear.mock.calls[0][0] as { messages: Array<Record<string, unknown>> };
    const sys = cuerpo.messages[0];
    expect(sys.role).toBe('system');
    const bloques = sys.content as Array<Record<string, unknown>>;
    expect(Array.isArray(bloques)).toBe(true);
    expect(bloques[0].text).toBe('CORPUS NORMATIVO COMPLETO…');
    expect(bloques[0].cache_control).toEqual({ type: 'ephemeral' });
    // El mensaje del usuario (la pregunta, que cambia caso a caso) NO se marca.
    expect(JSON.stringify(cuerpo.messages[1])).not.toContain('cache_control');
  });

  it('con un modelo que no es de Anthropic NO manda cache_control', async () => {
    crear.mockResolvedValue(respuesta('google/gemini-3.5-flash-lite'));
    await generateResponse({
      role: 'chat', system: 'S',
      messages: [{ role: 'user', content: 'hola' }],
    });
    const cuerpo = crear.mock.calls[0][0] as { messages: Array<Record<string, unknown>> };
    expect(typeof cuerpo.messages[0].content).toBe('string');
    expect(JSON.stringify(cuerpo.messages[0])).not.toContain('cache_control');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL RAZONAMIENTO OCULTO SE APAGA PARA EL CONTADOR — hallazgo del primer
// examen real (28-ago-2026): con el corpus completo en el prompt y
// `max_tokens: 900`, Sonnet 5 se comió el presupuesto ENTERO en razonamiento
// oculto (`finish_reason: 'length'`, `content: null`) en varias de las 32
// preguntas — y el runner leyó ese texto vacío como «abstención» del
// contador, cuando en realidad el modelo nunca llegó a escribir nada. Sin
// esta prueba, un ajuste futuro que reordene `opcionesDeRazonamiento` podría
// reintroducir el mismo silencio sin que nadie lo note hasta la próxima
// corrida de $1+ dólar.
// ═══════════════════════════════════════════════════════════════════════════
describe('el razonamiento oculto se apaga para el contador (generateResponse)', () => {
  beforeEach(() => { crear.mockReset(); process.env.OPENROUTER_API_KEY = 'x'; });

  it('manda reasoning:{enabled:false} para el contador — todo el presupuesto de tokens va a texto visible', async () => {
    crear.mockResolvedValue(respuesta('anthropic/claude-sonnet-5'));
    await generateResponse({
      role: 'contador', system: 'CORPUS…',
      messages: [{ role: 'user', content: '¿Q1?' }],
    });
    const cuerpo = crear.mock.calls[0][0] as { reasoning?: unknown };
    expect(cuerpo.reasoning).toEqual({ enabled: false });
  });

  it('otros roles NO mandan la llave reasoning (sin cambio de comportamiento)', async () => {
    crear.mockResolvedValue(respuesta('google/gemini-3.5-flash-lite'));
    await generateResponse({
      role: 'chat', system: 'S',
      messages: [{ role: 'user', content: 'hola' }],
    });
    const cuerpo = crear.mock.calls[0][0] as { reasoning?: unknown };
    expect(cuerpo.reasoning).toBeUndefined();
  });
});
