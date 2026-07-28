import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// B23 — Los tokens de ANTES del fallback se cobraban al precio de DESPUÉS.
//
// `generateWithTools` acumula tokIn/tokOut a lo largo de todas las rondas y
// precifica UNA vez al final, con el modelo activo en ese momento. Si el ciclo
// corrió tres rondas con el primario y cayó al fallback en la cuarta, las
// cuatro se cobran al precio del fallback.
//
// La corrección anterior (atribuir a activeModel en vez de al primario) arregló
// el caso de "todo el ciclo en fallback" y dejó abierto el mixto.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools, calcCost } = await import('./openrouter');
const { modelFor } = await import('./models');

// Se leen del registro real: fijar los slugs a mano haría que este test dejara
// de probar el camino vivo en cuanto se cambiara un modelo por env.
const PRIM = modelFor('chat');                        // google/gemini-3.5-flash-lite
const FALL = 'openai/gpt-5.6-luna';                   // su fallback cross-provider

const conTool = (model: string, tokIn: number, tokOut: number) => ({
  choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }] } }],
  usage: { prompt_tokens: tokIn, completion_tokens: tokOut }, model,
});
const final = (model: string, tokIn: number, tokOut: number) => ({
  choices: [{ message: { content: 'listo', tool_calls: [] } }],
  usage: { prompt_tokens: tokIn, completion_tokens: tokOut }, model,
});
// isTransientError mira el MENSAJE, no la propiedad status.
const caido = () => new Error('503 Service Unavailable: provider caído');

const correr = () => generateWithTools({
  role: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }],
  tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } }],
  toolExecutor: async () => ({ success: true, result: { ok: 1 }, durationMs: 1 }),
});

describe('generateWithTools — precio por ronda, con el modelo de esa ronda', () => {
  beforeEach(() => { create.mockReset(); });

  it('un ciclo entero en el primario cobra al precio del primario', async () => {
    create.mockResolvedValueOnce(conTool(PRIM, 100, 20)).mockResolvedValueOnce(final(PRIM, 150, 30));
    const r = await correr();
    expect(r.cost).toBeCloseTo(calcCost(PRIM, 250, 50), 12);
  });

  it('ronda en primario + ronda en fallback: cada una a SU precio', async () => {
    expect(FALL).not.toBe(PRIM);
    create
      .mockResolvedValueOnce(conTool(PRIM, 100, 20))   // ronda 1: primario
      .mockRejectedValueOnce(caido())                   // ronda 2: el primario cae...
      .mockResolvedValueOnce(final(FALL, 150, 30));    // ...y responde el fallback
    const r = await correr();
    expect(r.cost).toBeCloseTo(calcCost(PRIM, 100, 20) + calcCost(FALL, 150, 30), 12);
    // Lo que hacía antes: TODO al precio del fallback.
    if (calcCost(PRIM, 100, 20) !== calcCost(FALL, 100, 20)) {
      expect(r.cost).not.toBeCloseTo(calcCost(FALL, 250, 50), 12);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL COSTO DEL CICLO QUE SE CAYÓ TAMBIÉN SE PAGÓ.
//
// `PartialExecutionError` llevaba las tools ejecutadas pero NO el costo de las
// rondas que sí corrieron. Y el processor, en su rama de recuperación de cierre
// parcial —flag ya activo por default—, nunca llamaba `registrarCosto`.
//
// Resultado: la liquidación que cae por ahí sale con su PDF, pero lo que se
// gastó en OpenRouter para producirla es invisible. Para un negocio que va a
// cobrar POR LIQUIDACIÓN, el costo unitario queda subestimado justo en el caso
// de más presión, que es el que más consume.
// ═══════════════════════════════════════════════════════════════════════════
describe('generateWithTools — el error carga lo que ya se pagó', () => {
  beforeEach(() => { create.mockReset(); });

  it('PartialExecutionError trae los tokens y el costo de las rondas que corrieron', async () => {
    create
      .mockResolvedValueOnce(conTool(PRIM, 100, 20))       // ronda 1: se pagó
      .mockRejectedValueOnce(new Error('boom irrecuperable')); // ronda 2: revienta
    const err = await correr().catch((e) => e);
    expect(err.name).toBe('PartialExecutionError');
    expect(err.tokensIn, 'la ronda 1 se cobró y tiene que viajar en el error').toBe(100);
    expect(err.tokensOut).toBe(20);
    expect(err.cost).toBeCloseTo(calcCost(PRIM, 100, 20), 12);
  });

  it('si revienta la primera ronda, el costo es 0 pero los campos existen', async () => {
    create.mockRejectedValueOnce(new Error('provider caído del todo'));
    const err = await correr().catch((e) => e);
    expect(err.tokensIn).toBe(0);
    expect(err.cost).toBe(0);
  });
});
