import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDITORÍA 32 · c17 · TOO-C17-C1 (CRÍTICO) — OFRECER NO ES ACOTAR.
//
// `runAgent` acotaba lo que se OFRECE al modelo (`toolSchemas(config.tools)`)
// y pasaba `makeExecutor(ctx)` CRUDO. `executeTool` resuelve el nombre contra
// el `REGISTRY` global del módulo, y ese registro está contaminado por una
// cadena de imports de puro efecto que ocurre en el primer mensaje de
// WhatsApp:
//
//   processor.ts:52 → vigia/servicio.ts:33 → vigia/enviar.ts:20
//     → vigia/redactor.ts:24 → agents/analista.ts:35 → `import './chat-tools'`
//
// Resultado: el agente del CHOFER podía ejecutar `viajes_flota` (nombres de
// los otros operadores + anticipo de cada viaje de la flota), `motor_fiscal`,
// `liquidaciones_flota` y `top_rutas` — tools del PANEL, del área `dinero`,
// que un jefe de tráfico del propio panel no puede ver. El repo ya lo tenía
// escrito: `conPermisos` existe «para que una tool registrada para otro
// agente, una inventada, una de otra área, se rechace SIN ejecutarse», y
// estaba cableado al analista y nunca al ciclo del cuadre.
//
// Lo que estas pruebas anclan es el CONTRATO, no la lista: el ejecutor que
// `runAgent` entrega niega cualquier nombre fuera de `config.tools`.

const generateWithTools = vi.fn(async (_o: unknown) => ({
  finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, cost: 0, costoPorModelo: {},
}));
vi.mock('@/lib/llm/openrouter', () => ({ generateWithTools: (o: unknown) => generateWithTools(o) }));

// El ejecutor crudo corre CUALQUIER nombre: es el `REGISTRY` global del módulo
// real, aquí representado por un espía que siempre acepta.
const corridas: string[] = [];
vi.mock('@/lib/llm/tool-executor', () => ({
  toolSchemas: (nombres: string[]) => nombres.map((n) => ({ type: 'function', function: { name: n, parameters: {} } })),
  makeExecutor: () => async (name: string) => {
    corridas.push(name);
    return { success: true, result: { fuga: 'anticipos y nombres de la flota' }, durationMs: 0 };
  },
}));
vi.mock('./prompts', () => ({ getSystemPrompt: () => 'sistema' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { runAgent } = await import('./run');
const { AGENT_REGISTRY } = await import('./registry');

const TENANT = { tenantId: 'flota-abc' } as never;
const CTX = { tenantId: 'flota-abc', operadorId: 'op-7', viajeId: 'v-9' } as never;

/** El ejecutor que `runAgent` le entregó de verdad a `generateWithTools`. */
async function ejecutorEntregado(): Promise<(n: string, a: Record<string, unknown>) => Promise<{ success: boolean; result: unknown; error?: string }>> {
  corridas.length = 0;
  generateWithTools.mockClear();
  await runAgent({ agent: 'liquidacion', tenant: TENANT, ctx: CTX, history: [] });
  const opts = generateWithTools.mock.calls[0][0] as { toolExecutor: never };
  return opts.toolExecutor as never;
}

describe('TOO-C17-C1 — el ejecutor del cuadre solo corre las tools que se le ofrecieron', () => {
  beforeEach(() => { corridas.length = 0; });

  it('niega `viajes_flota` SIN ejecutarla: es del panel, no del chofer', async () => {
    const ejecutar = await ejecutorEntregado();
    const r = await ejecutar('viajes_flota', {});

    // El handler NO corrió: nada tocó la base ni volvió al modelo.
    expect(corridas).not.toContain('viajes_flota');
    expect(JSON.stringify(r.result)).not.toContain('anticipos');
  });

  it('niega las otras tools de dinero del panel y una inventada', async () => {
    const ejecutar = await ejecutorEntregado();
    for (const n of ['motor_fiscal', 'liquidaciones_flota', 'top_rutas', 'duplicados_detectados', 'kpis_flota', 'borrar_todo']) {
      await ejecutar(n, {});
    }
    expect(corridas).toEqual([]);
  });

  it('sí corre las cuatro que el agente de liquidación declara', async () => {
    const ejecutar = await ejecutorEntregado();
    for (const n of AGENT_REGISTRY.liquidacion.tools) await ejecutar(n, {});
    expect(corridas).toEqual([...AGENT_REGISTRY.liquidacion.tools]);
  });

  it('el conjunto permitido se DERIVA de `config.tools`, no es una lista copiada', async () => {
    // Si alguien agrega una tool al agente, el ejecutor la deja pasar sin
    // tocar este archivo; si la quita, deja de pasar. Es el contrato.
    const ejecutar = await ejecutorEntregado();
    const ofrecidas = (generateWithTools.mock.calls[0][0] as { tools: Array<{ function: { name: string } }> }).tools.map((t) => t.function.name);
    expect(ofrecidas).toEqual([...AGENT_REGISTRY.liquidacion.tools]);
    for (const n of ofrecidas) await ejecutar(n, {});
    expect(corridas).toEqual(ofrecidas);
  });
});
