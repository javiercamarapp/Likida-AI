import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · RES-4 — el cliente nacía sin techo.
//
// `new OpenAI({...})` sin `maxRetries` ni `timeout` toma los defaults del SDK:
// DOS reintentos por llamada y, ante un 429, la espera que pida el
// `Retry-After` del proveedor (OpenRouter manda 60 s). Encima, openrouter.ts
// ya tiene su propia escalera de tres intentos con fallback cross-provider.
// 3 × 3 = hasta NUEVE peticiones dentro de una invocación de 120 s que, cuando
// muere, se lleva la ráfaga entera: Meta ya dio su 200 y no reintenta.
//
// Los reintentos viven en UNA capa —la de este archivo, que además cambia de
// proveedor— y cada petición tiene tope.
// ═══════════════════════════════════════════════════════════════════════════

const opcionesDelCliente: Array<Record<string, unknown>> = [];
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: vi.fn() } };
    constructor(opts: Record<string, unknown>) { opcionesDelCliente.push(opts); }
  },
}));

process.env.OPENROUTER_API_KEY = 'test-key';

beforeEach(() => { opcionesDelCliente.length = 0; vi.resetModules(); });

describe('el cliente de OpenRouter nace acotado', () => {
  it('maxRetries 0: el SDK NO reintenta por su cuenta (esa capa es de este archivo)', async () => {
    const { getClient } = await import('./openrouter');
    getClient();
    expect(opcionesDelCliente[0].maxRetries).toBe(0);
  });

  it('timeout explícito por petición, no el default del SDK (10 min)', async () => {
    const { getClient, TIMEOUT_LLM_MS } = await import('./openrouter');
    getClient();
    expect(opcionesDelCliente[0].timeout).toBe(TIMEOUT_LLM_MS);
    // Tiene que caber holgado dentro del presupuesto de la invocación del
    // webhook (120 s) DEJANDO aire para el fallback cross-provider.
    expect(TIMEOUT_LLM_MS).toBeLessThanOrEqual(45_000);
  });

  it('el cliente se construye UNA vez y se reusa', async () => {
    const { getClient } = await import('./openrouter');
    getClient(); getClient();
    expect(opcionesDelCliente).toHaveLength(1);
  });
});
