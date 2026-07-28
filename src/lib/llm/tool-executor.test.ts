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

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — la llave de la dedup describía la LLAMADA, no el EFECTO.
//
// `${name}:${JSON.stringify(args)}` sostenía la promesa del docstring ("evita un
// doble guardar_liquidacion, doble PDF/costo"). Pero NINGUNA tool de Likida tiene
// parámetros a propósito: el modelo decide CUÁNDO, nunca CON QUÉ DATOS, y el
// efecto depende solo de ctx.tenantId/ctx.viajeId. El handler de
// guardar_liquidacion recibe `_args` y no lo usa jamás.
//
// Así que un byte de diferencia en args —o el mismo objeto con las claves en otro
// orden— rompía la dedup, y `tool.mutation_dedup` no se disparaba: en el log
// parecía que había funcionado. Lo que hoy salva el dinero no es esta rejilla,
// es el `on conflict (viaje_id)` de la migración 0021. La cuarta tool que se
// registre hereda la promesa rota sin un upsert que la absorba.
// ═══════════════════════════════════════════════════════════════════════════
describe('la dedup de mutaciones mira el EFECTO, no cómo se escribió la llamada', () => {
  it('args distintos NO autorizan una segunda ejecución', async () => {
    let calls = 0;
    registerTool('test_mut_args', { isMutation: true, schema: schema('test_mut_args'), handler: async () => ({ n: ++calls }) });
    const exec = makeExecutor({ tenantId: 't' });
    const r1 = await exec('test_mut_args', {});
    const r2 = await exec('test_mut_args', { confirmar: true });
    expect(calls).toBe(1);
    expect(r2.result).toEqual(r1.result);
  });

  it('ni el mismo objeto con las claves en otro orden', async () => {
    let calls = 0;
    registerTool('test_mut_orden', { isMutation: true, schema: schema('test_mut_orden'), handler: async () => ({ n: ++calls }) });
    const exec = makeExecutor({ tenantId: 't' });
    await exec('test_mut_orden', { a: 1, b: 2 });
    await exec('test_mut_orden', { b: 2, a: 1 });
    expect(calls).toBe(1);
  });

  it('ni `null`, que es JSON válido y llegaba como llave propia', async () => {
    let calls = 0;
    registerTool('test_mut_null', { isMutation: true, schema: schema('test_mut_null'), handler: async () => ({ n: ++calls }) });
    const exec = makeExecutor({ tenantId: 't' });
    await exec('test_mut_null', {});
    await exec('test_mut_null', null as unknown as Record<string, unknown>);
    expect(calls).toBe(1);
  });

  it('un fallo sigue siendo reintentable (regresión: no se cachea el error)', async () => {
    let calls = 0;
    registerTool('test_mut_args_fail', {
      isMutation: true, schema: schema('test_mut_args_fail'),
      handler: async () => { calls++; if (calls === 1) throw new Error('blip'); return { ok: true }; },
    });
    const exec = makeExecutor({ tenantId: 't' });
    expect((await exec('test_mut_args_fail', {})).success).toBe(false);
    expect((await exec('test_mut_args_fail', { otro: 1 })).success).toBe(true);
    expect(calls).toBe(2);
  });
});
