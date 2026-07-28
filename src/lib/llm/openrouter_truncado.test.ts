import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Regresión del bug encontrado con comprobantes REALES (27-jul-2026): la
// respuesta se cortaba en max_tokens y el ticket se reportaba como "foto
// ilegible". Se mockea el SDK de OpenAI para controlar finish_reason.
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...a: unknown[]) => create(...a) } };
  },
}));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateStructured, TruncatedError } = await import('./openrouter');

const schema = z.object({ monto: z.number() });
const ok = (content: string) => ({
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
  model: 'google/gemini-3.6-flash',
});
const truncada = () => ({
  // Así se ve de verdad: JSON abierto a media línea, cortado por presupuesto.
  choices: [{ finish_reason: 'length', message: { content: '{\n  "monto": 1000.00' } }],
  usage: { prompt_tokens: 100, completion_tokens: 1184 },
  model: 'google/gemini-3.6-flash',
});

const llamar = () =>
  generateStructured({
    role: 'ocr',
    system: 's',
    messages: [{ role: 'user', content: 'u' }],
    schema,
    schemaName: 'x',
  });

describe('generateStructured — respuesta truncada', () => {
  // Con llaves: si devuelve el mock, vitest lo usa como limpieza y lo invoca.
  beforeEach(() => { create.mockReset(); });

  it('finish_reason=length NO se reporta como JSON malformado', async () => {
    create.mockResolvedValue(truncada());
    await expect(llamar()).rejects.toBeInstanceOf(TruncatedError);
    await expect(llamar()).rejects.toThrow(/truncada/i);
  });

  it('reintenta con el DOBLE de presupuesto en vez de regañar al modelo', async () => {
    create.mockResolvedValueOnce(truncada()).mockResolvedValueOnce(ok('{"monto":507.65}'));
    const r = await llamar();
    expect(r.data.monto).toBe(507.65);
    expect(create).toHaveBeenCalledTimes(2);
    const tope1 = create.mock.calls[0][0].max_tokens;
    const tope2 = create.mock.calls[1][0].max_tokens;
    expect(tope2).toBe(tope1 * 2);
    // El reintento por truncamiento NO lleva la nota de "responde solo JSON":
    // el modelo ya obedecía, lo que le faltó fue techo.
    expect(create.mock.calls[1][0].messages[0].content).toBe('s');
  });

  it('si el doble tampoco alcanza, falla como truncamiento (no como formato)', async () => {
    create.mockResolvedValue(truncada());
    await expect(llamar()).rejects.toBeInstanceOf(TruncatedError);
    expect(create).toHaveBeenCalledTimes(2); // no sigue por la escalera de formato
  });

  it('el error carga el consumo: una llamada fallida SÍ se cobró', async () => {
    create.mockResolvedValue(truncada());
    let e: unknown;
    try { await llamar(); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(TruncatedError);
    const err = e as InstanceType<typeof TruncatedError>;
    expect(err.usage?.tokensOut).toBe(1184);
    expect(err.usage?.cost).toBeGreaterThan(0);
  });

  it('un JSON de verdad malformado sigue yendo por la escalera de formato', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'no soy json' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'google/gemini-3.6-flash',
    });
    await expect(llamar()).rejects.toThrow(/JSON parse/);
    // primario + reintento con nota + fallback cross-provider
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
