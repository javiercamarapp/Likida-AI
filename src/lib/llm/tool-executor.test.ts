import { describe, it, expect } from 'vitest';
import { registerTool, makeExecutor } from './tool-executor';
import type OpenAI from 'openai';

const schema = (name: string): OpenAI.Chat.ChatCompletionTool => ({
  type: 'function',
  function: { name, parameters: { type: 'object', properties: {}, additionalProperties: false } },
});

describe('makeExecutor — idempotencia de mutaciones (1.5)', () => {
  it('una mutación NO se re-ejecuta en el mismo run (dedup)', async () => {
    let calls = 0;
    registerTool('test_mut', { isMutation: true, schema: schema('test_mut'), handler: async () => ({ n: ++calls }) });
    const exec = makeExecutor({ tenantId: 't' });
    const r1 = await exec('test_mut', {});
    const r2 = await exec('test_mut', {});
    expect(calls).toBe(1);                 // segunda llamada → cache
    expect(r2.result).toEqual(r1.result);
  });

  it('un read-only SÍ puede correr varias veces (no se dedupea aquí)', async () => {
    let calls = 0;
    registerTool('get_test', { schema: schema('get_test'), handler: async () => ({ n: ++calls }) });
    const exec = makeExecutor({ tenantId: 't' });
    await exec('get_test', {});
    await exec('get_test', {});
    expect(calls).toBe(2);
  });

  it('si la mutación FALLA, se permite reintentar (no se cachea el error)', async () => {
    let calls = 0;
    registerTool('test_mut_fail', {
      isMutation: true, schema: schema('test_mut_fail'),
      handler: async () => { calls++; if (calls === 1) throw new Error('fallo transitorio'); return { ok: true }; },
    });
    const exec = makeExecutor({ tenantId: 't' });
    const r1 = await exec('test_mut_fail', {});
    const r2 = await exec('test_mut_fail', {});
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(true);         // reintento permitido
    expect(calls).toBe(2);
  });
});
