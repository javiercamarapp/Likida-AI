import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// La tabla FALLBACK se indexa por SLUG. El 4-ago-2026 se cambió el OCR a
// `google/gemini-3.1-flash-lite` por `CUADRA_MODEL_OCR` (medido 12× más
// barato y más certero, ver models.ts) y se agregó su precio a `PRICES` —
// pero la entrada en `FALLBACK` se quedó fuera hasta que otra pasada la
// completó (openrouter.ts:63). Sin ella, `FALLBACK[model] ?? null` da `null`
// y el respaldo cross-provider queda APAGADO EN SILENCIO: nada truena en el
// deploy, solo deja de haber plan B. Un Gemini caído se leía como "tu foto
// salió ilegible" en vez de caer a Anthropic.
//
// Esta prueba fija el override de producción (CUADRA_MODEL_OCR apuntando al
// modelo lite) y verifica que un fallo transitorio SÍ cruza de proveedor.
// Sin la entrada en FALLBACK, este test falla con el error original del
// primario en vez de resolver con el modelo de respaldo.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...a: unknown[]) => create(...a) } };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
// El override real que vive en Vercel — no el default de models.ts.
process.env.CUADRA_MODEL_OCR = 'google/gemini-3.1-flash-lite';
const { generateStructured } = await import('./openrouter');
const { modelFor } = await import('./models');

const PRIM = modelFor('ocr');
const FALL = 'anthropic/claude-haiku-4.5';

const schema = z.object({ monto: z.number() });
const caido = () => new Error('503 Service Unavailable: provider caído');
const ok = (model: string) => ({
  choices: [{ finish_reason: 'stop', message: { content: '{"monto":507.65}' } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
  model,
});

const llamar = () =>
  generateStructured({
    role: 'ocr',
    system: 's',
    messages: [{ role: 'user', content: 'u' }],
    schema,
    schemaName: 'x',
  });

describe('generateStructured — fallback cross-provider cuando OCR corre en el override de producción', () => {
  beforeEach(() => { create.mockReset(); });

  it('confirma que el rol ocr resuelve al modelo lite bajo el override (precondición del bug)', () => {
    expect(PRIM).toBe('google/gemini-3.1-flash-lite');
  });

  it('un fallo transitorio del primario SÍ cae al fallback cross-provider', async () => {
    create
      .mockRejectedValueOnce(caido())   // intento 1: primario, sin nota
      .mockRejectedValueOnce(caido())   // intento 2: primario, con nota de formato
      .mockResolvedValueOnce(ok(FALL)); // intento 3: fallback

    const r = await llamar();

    expect(r.data.monto).toBe(507.65);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0][0].model).toBe(PRIM);
    expect(create.mock.calls[1][0].model).toBe(PRIM);
    expect(create.mock.calls[2][0].model, 'la 3ª llamada tiene que cruzar de proveedor').toBe(FALL);
  });
});
