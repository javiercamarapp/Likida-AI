import { describe, it, expect, beforeEach, vi } from 'vitest';

// A37-L-06 — circuit breaker del camino LLM, y A37-L-01 — 401/402/403 no se repiten.
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
process.env.OPENROUTER_API_KEY = 'test-key';

import { z } from 'zod';
const { UMBRAL_FALLOS, ABIERTO_MS, breakerFallo, breakerVerificar, breakerExito, conBreaker, esFalloDeProveedor, _reiniciarBreaker, CircuitoLlmAbiertoError } = await import('./breaker');
const { generateStructured, isTransientError, esFalloDeCredencial } = await import('./openrouter');

const timeoutErr = () => Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

beforeEach(() => { _reiniciarBreaker(); create.mockReset(); });

describe('A37-L-06 breaker por rol', () => {
  it('abre tras UMBRAL_FALLOS timeouts seguidos y falla AL INSTANTE', () => {
    for (let i = 0; i < UMBRAL_FALLOS; i++) breakerFallo('agente', timeoutErr(), 1000 + i);
    expect(() => breakerVerificar('agente', 2000)).toThrow(CircuitoLlmAbiertoError);
    expect(() => breakerVerificar('ocr', 2000)).not.toThrow();           // otro rol no se contagia
    expect(() => breakerVerificar('agente', 1002 + ABIERTO_MS + 1)).not.toThrow(); // pasado el lapso deja pasar la sonda
  });

  it('401/402/429, aborts propios y JSON malo NO cuentan', () => {
    const noCuentan = [
      Object.assign(new Error('x'), { status: 401 }), Object.assign(new Error('x'), { status: 402 }),
      Object.assign(new Error('x'), { status: 429 }), Object.assign(new Error('x'), { name: 'APIUserAbortError' }),
      new Error('JSON parse falló'),
    ];
    for (const e of noCuentan) expect(esFalloDeProveedor(e)).toBe(false);
    for (let i = 0; i < 10; i++) breakerFallo('agente', noCuentan[i % noCuentan.length], 1000 + i);
    expect(() => breakerVerificar('agente', 1100)).not.toThrow();
  });

  it('un éxito reinicia la cuenta', () => {
    breakerFallo('agente', timeoutErr(), 1); breakerFallo('agente', timeoutErr(), 2);
    breakerExito('agente');
    breakerFallo('agente', timeoutErr(), 3);
    expect(() => breakerVerificar('agente', 4)).not.toThrow();
  });

  it('el error del breaker abierto es transitorio: el llamador degrada', () => {
    expect(isTransientError(new CircuitoLlmAbiertoError('agente', 1000))).toBe(true);
  });

  it('conBreaker: abierto no llama a la red', async () => {
    for (let i = 0; i < UMBRAL_FALLOS; i++) breakerFallo('agente', timeoutErr());
    const red = vi.fn(async () => 1);
    await expect(conBreaker('agente', red)).rejects.toBeInstanceOf(CircuitoLlmAbiertoError);
    expect(red).not.toHaveBeenCalled();
  });
});

describe('generateStructured: sin apilar reintentos', () => {
  const opts = { role: 'ocr' as const, system: 's', messages: [{ role: 'user' as const, content: 'u' }], schema: z.object({ a: z.number() }), schemaName: 'x' };

  it('A37-L-01: un 402 NO se repite (una sola petición) y el error conserva el status', async () => {
    create.mockRejectedValue(Object.assign(new Error('Insufficient credits'), { status: 402 }));
    const e = await generateStructured(opts).catch((x) => x);
    expect(create).toHaveBeenCalledTimes(1);
    expect(esFalloDeCredencial(e)).toBe(true);
  });

  it('A37-L-01: un 401 tampoco', async () => {
    create.mockRejectedValue(Object.assign(new Error('No auth'), { status: 401 }));
    await generateStructured(opts).catch(() => null);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('A37-L-06: tras un TIMEOUT no se repite el mismo modelo con nota: a lo más modelo + respaldo', async () => {
    create.mockRejectedValue(timeoutErr());
    await generateStructured(opts).catch(() => null);
    expect(create.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('A37-L-06: con el breaker abierto no hay ni una petición', async () => {
    for (let i = 0; i < UMBRAL_FALLOS; i++) breakerFallo('ocr', timeoutErr());
    const e = await generateStructured(opts).catch((x) => x);
    expect(create).not.toHaveBeenCalled();
    expect(isTransientError(e) || /breaker/i.test(String((e as Error).message))).toBe(true);
  });
});
