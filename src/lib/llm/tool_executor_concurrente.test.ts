import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { registerTool, makeExecutor } from './tool-executor';

// ═══════════════════════════════════════════════════════════════════════════
// LA IDEMPOTENCIA DE MUTACIONES TIENE QUE SOSTENERSE BAJO CONCURRENCIA.
//
// `generateWithTools` lanza TODAS las tool_calls de una ronda con `Promise.all`
// (openrouter.ts). La rejilla de `makeExecutor` era `get` … `await` … `set`:
// dos invocaciones concurrentes pasaban las dos por el `if` con la caché vacía y
// el handler corría dos veces, sin que `tool.mutation_dedup` se disparara — en
// el log parecía que la rejilla había funcionado.
//
// Medido sobre lo que corre `guardar_liquidacion`: 2 × cuadre completo,
// 4 PDFs, 4 subidas a Storage sobre las MISMAS dos rutas y 2 RPC de escritura.
// El dinero lo salvaba el `on conflict (viaje_id)` de la migración 0021, no
// este archivo.
//
// La otra rejilla (`inRound`, en openrouter.ts) se llavea con
// `nombre:JSON.stringify(args)` — exactamente la llave que se quitó de aquí por
// describir la LLAMADA y no el EFECTO —, así que con args distintos no junta
// nada. Nada obliga a que `arguments` sea `{}`: los schemas de tools no llevan
// `strict: true`.
// ═══════════════════════════════════════════════════════════════════════════

const schema = (name: string): OpenAI.Chat.ChatCompletionTool => ({
  type: 'function',
  function: { name, description: 'tool de prueba', parameters: { type: 'object', properties: {}, additionalProperties: false } },
});

describe('makeExecutor — mutaciones concurrentes', () => {
  it('dos llamadas EN PARALELO con args distintos ejecutan el handler UNA vez', async () => {
    let ejecuciones = 0;
    registerTool('guardar_concurrente_args', {
      isMutation: true,
      schema: schema('guardar_concurrente_args'),
      handler: async () => {
        ejecuciones++;
        // La ventana real: el handler hace I/O (cuadre, PDF, Storage, RPC).
        await new Promise((r) => setTimeout(r, 5));
        return { liquidacion_id: `L-${ejecuciones}` };
      },
    });
    const exec = makeExecutor({ tenantId: 't1', viajeId: 'v1' });

    // Es el caso para el que existe `inRound`, con el segundo argumento que el
    // modelo puede inventar porque el schema no lo prohíbe.
    const [a, b] = await Promise.all([
      exec('guardar_concurrente_args', {}),
      exec('guardar_concurrente_args', { confirmar: true }),
    ]);

    expect(ejecuciones).toBe(1);
    expect(a.result).toEqual({ liquidacion_id: 'L-1' });
    expect(b.result).toEqual({ liquidacion_id: 'L-1' });
  });

  it('dos llamadas EN PARALELO con args idénticos también ejecutan una vez', async () => {
    let ejecuciones = 0;
    registerTool('guardar_concurrente_igual', {
      isMutation: true,
      schema: schema('guardar_concurrente_igual'),
      handler: async () => { ejecuciones++; await new Promise((r) => setTimeout(r, 5)); return { ok: true }; },
    });
    const exec = makeExecutor({ tenantId: 't1' });
    await Promise.all([exec('guardar_concurrente_igual', {}), exec('guardar_concurrente_igual', {})]);
    expect(ejecuciones).toBe(1);
  });

  it('tres en paralelo y una cuarta después: una sola ejecución en todo el run', async () => {
    let ejecuciones = 0;
    registerTool('guardar_concurrente_tres', {
      isMutation: true,
      schema: schema('guardar_concurrente_tres'),
      handler: async () => { ejecuciones++; await new Promise((r) => setTimeout(r, 5)); return { n: ejecuciones }; },
    });
    const exec = makeExecutor({ tenantId: 't1' });
    await Promise.all([
      exec('guardar_concurrente_tres', {}),
      exec('guardar_concurrente_tres', { a: 1 }),
      exec('guardar_concurrente_tres', { a: 1, b: 2 }),
    ]);
    const cuarta = await exec('guardar_concurrente_tres', { otra: 'ronda' });
    expect(ejecuciones).toBe(1);
    expect(cuarta.result).toEqual({ n: 1 });
  });

  it('un FALLO no queda cacheado: el siguiente intento sí vuelve a ejecutar', async () => {
    // Cachear el fracaso convierte un blip de un segundo en un fallo permanente
    // del turno. Es la misma regla que la caché de lectura de openrouter.ts.
    let ejecuciones = 0;
    registerTool('guardar_concurrente_falla', {
      isMutation: true,
      schema: schema('guardar_concurrente_falla'),
      handler: async () => {
        ejecuciones++;
        await new Promise((r) => setTimeout(r, 2));
        if (ejecuciones === 1) throw new Error('supabase caído');
        return { ok: true };
      },
    });
    const exec = makeExecutor({ tenantId: 't1' });
    const primera = await exec('guardar_concurrente_falla', {});
    expect(primera.success).toBe(false);
    const segunda = await exec('guardar_concurrente_falla', {});
    expect(segunda.success).toBe(true);
    expect(ejecuciones).toBe(2);
  });

  it('dos fallos EN PARALELO comparten la ejecución y ninguno envenena la caché', async () => {
    let ejecuciones = 0;
    registerTool('guardar_concurrente_falla_par', {
      isMutation: true,
      schema: schema('guardar_concurrente_falla_par'),
      handler: async () => {
        ejecuciones++;
        await new Promise((r) => setTimeout(r, 5));
        if (ejecuciones === 1) throw new Error('supabase caído');
        return { ok: true };
      },
    });
    const exec = makeExecutor({ tenantId: 't1' });
    const [a, b] = await Promise.all([
      exec('guardar_concurrente_falla_par', {}),
      exec('guardar_concurrente_falla_par', { x: 1 }),
    ]);
    expect(ejecuciones).toBe(1);
    expect(a.success).toBe(false);
    expect(b.success).toBe(false);
    // Y la caché quedó limpia: un reintento posterior sí corre.
    const tercera = await exec('guardar_concurrente_falla_par', {});
    expect(tercera.success).toBe(true);
    expect(ejecuciones).toBe(2);
  });

  it('las tools de LECTURA no se deduplican (no son mutación)', async () => {
    let ejecuciones = 0;
    registerTool('consultar_concurrente', {
      schema: schema('consultar_concurrente'),
      handler: async () => { ejecuciones++; return { ok: true }; },
    });
    const exec = makeExecutor({ tenantId: 't1' });
    await Promise.all([exec('consultar_concurrente', {}), exec('consultar_concurrente', {})]);
    expect(ejecuciones).toBe(2);
  });
});
