import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 · BAJO REINCIDENTE — el loop-guard corría la ÚLTIMA ronda
// COMPLETA antes de tirar `LoopGuardError`, en vez de cortar ANTES.
//
// El `for` permite `maxRounds` vueltas. Si en la última (ronda `maxRounds`) el
// modelo TODAVÍA pide tools en vez de cerrar con texto, no existe una ronda
// siguiente que vaya a leer esas tool_calls — el ciclo iba a tirar
// `LoopGuardError` de todos modos en cuanto el `for` terminara. Ejecutarlas de
// todas formas paga una ronda entera (llamadas de red, y si el modelo pide
// `guardar_liquidacion`, una MUTACIÓN) por un resultado que nadie consume.
//
// La corrección corta ANTES del `Promise.all` que dispara esas tools, no
// después de pagarlas — la llamada al LLM de esa última ronda sigue
// haciéndose (hace falta para SABER que el modelo no iba a cerrar), pero la
// ejecución de sus tools ya no.
// ═══════════════════════════════════════════════════════════════════════════

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateWithTools, LoopGuardError, PartialExecutionError } = await import('./openrouter');

// Args DISTINTOS en cada ronda para que la caché de lectura nunca acierte y
// cada ronda dispare una ejecución real — así se puede contar sin ambigüedad
// cuántas rondas de verdad ejecutaron tools.
const pideTool = (n: number) => ({
  choices: [{ message: { content: null, tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'nunca_cierra', arguments: JSON.stringify({ n }) } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});

describe('loop-guard — corta ANTES de ejecutar la ronda que ya sabe que excede el límite', () => {
  beforeEach(() => { create.mockReset(); });

  it('con maxToolRounds:3, la 3ª ronda NO ejecuta su tool antes de tirar LoopGuardError', async () => {
    create
      .mockResolvedValueOnce(pideTool(1))
      .mockResolvedValueOnce(pideTool(2))
      .mockResolvedValueOnce(pideTool(3)); // última ronda permitida: sigue pidiendo tools

    let ejecuciones = 0;
    const err = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'nunca_cierra', description: 'd', parameters: { type: 'object', properties: { n: { type: 'number' } } } } }],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { ok: true }, durationMs: 1 }; },
      maxToolRounds: 3,
    }).catch((e) => e);

    // Las 3 rondas SÍ le preguntan al modelo (hace falta para saber que no iba
    // a cerrar), pero la tool de la 3ª ronda —la que dispara el guard— nunca
    // se ejecuta.
    expect(create).toHaveBeenCalledTimes(3);
    expect(ejecuciones, 'la ronda que excede el límite no debe ejecutar su tool').toBe(2);

    // El guard sigue disparando (envuelto en PartialExecutionError, como
    // siempre) y las tools que SÍ corrieron (rondas 1 y 2) siguen viajando.
    expect(err).toBeInstanceOf(PartialExecutionError);
    expect(err.cause).toBeInstanceOf(LoopGuardError);
    expect(err.partialToolCalls).toHaveLength(2);
    expect(err.partialToolCalls.map((t: { args: { n: number } }) => t.args.n)).toEqual([1, 2]);
  });

  it('si el modelo cierra justo en la última ronda permitida, no hay guard ni tools de más', async () => {
    create
      .mockResolvedValueOnce(pideTool(1))
      .mockResolvedValueOnce(pideTool(2))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'listo', tool_calls: [] } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm' });

    let ejecuciones = 0;
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'nunca_cierra', description: 'd', parameters: { type: 'object', properties: { n: { type: 'number' } } } } }],
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { ok: true }, durationMs: 1 }; },
      maxToolRounds: 3,
    });

    expect(ejecuciones).toBe(2);
    expect(r.finalText).toBe('listo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · A30 — la tool TERMINAL no es una tool más. Su resultado no
// lo lee el modelo en la ronda siguiente: lo lee el orquestador por el canal
// lateral (`CAPTURAS`). El loop-guard la cortaba en la última ronda y tiraba
// una respuesta ya redactada y pagada (5 completions) para que el route
// contestara "no pude responder".
// ═══════════════════════════════════════════════════════════════════════════
const TOOLS = [
  { type: 'function' as const, function: { name: 'nunca_cierra', description: 'd', parameters: { type: 'object', properties: { n: { type: 'number' } } } } },
  { type: 'function' as const, function: { name: 'entregar_respuesta', description: 'd', parameters: { type: 'object', properties: { bloques: { type: 'array' } } } } },
];
const respuesta = (tools: Array<{ name: string; args: unknown }>, finish = 'tool_calls') => ({
  choices: [{ finish_reason: finish, message: { content: null, tool_calls: tools.map((t, i) => ({ id: `c${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
});

describe('A30 — la tool terminal sobrevive al loop-guard y cierra el ciclo', () => {
  beforeEach(() => { create.mockReset(); });

  it('en la ÚLTIMA ronda permitida, `entregar_respuesta` SÍ se ejecuta y el ciclo devuelve (no tira LoopGuardError)', async () => {
    create
      .mockResolvedValueOnce(pideTool(1))
      .mockResolvedValueOnce(pideTool(2))
      .mockResolvedValueOnce(respuesta([{ name: 'entregar_respuesta', args: { bloques: [1] } }]));

    const ejecutadas: string[] = [];
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS,
      toolExecutor: async (name) => { ejecutadas.push(name); return { success: true, result: { ok: true }, durationMs: 1 }; },
      maxToolRounds: 3,
      terminalTools: ['entregar_respuesta'],
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(ejecutadas).toEqual(['nunca_cierra', 'nunca_cierra', 'entregar_respuesta']);
    expect(r.toolCalls.map((t) => t.toolName)).toContain('entregar_respuesta');
    // Y el costo de las 3 rondas viaja en el return, no en una excepción.
    expect(r.tokensOut).toBe(15);
  });

  it('en la última ronda solo corren las TERMINALES: una lectura pedida junto a la entrega no se paga', async () => {
    create
      .mockResolvedValueOnce(pideTool(1))
      .mockResolvedValueOnce(respuesta([{ name: 'nunca_cierra', args: { n: 9 } }, { name: 'entregar_respuesta', args: { bloques: [1] } }]));

    const ejecutadas: string[] = [];
    await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS,
      toolExecutor: async (name) => { ejecutadas.push(name); return { success: true, result: { ok: true }, durationMs: 1 }; },
      maxToolRounds: 2,
      terminalTools: ['entregar_respuesta'],
    });
    expect(ejecutadas).toEqual(['nunca_cierra', 'entregar_respuesta']);
  });

  it('sin terminal en la última ronda, el guard sigue cortando como siempre', async () => {
    create.mockResolvedValueOnce(pideTool(1)).mockResolvedValueOnce(pideTool(2));
    const err = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS,
      toolExecutor: async () => ({ success: true, result: {}, durationMs: 1 }),
      maxToolRounds: 2,
      terminalTools: ['entregar_respuesta'],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PartialExecutionError);
    expect(err.cause).toBeInstanceOf(LoopGuardError);
  });

  it('cuando la terminal corre con éxito en una ronda temprana, NO se paga otra completion para oír "listo"', async () => {
    create
      .mockResolvedValueOnce(respuesta([{ name: 'entregar_respuesta', args: { bloques: [1] } }]))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'listo', tool_calls: [] } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm' });

    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS,
      toolExecutor: async () => ({ success: true, result: { ok: true }, durationMs: 1 }),
      maxToolRounds: 5,
      terminalTools: ['entregar_respuesta'],
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.toolCalls).toHaveLength(1);
  });

  it('si la terminal FALLA (bloques inválidos), el ciclo sigue para que el modelo la repita', async () => {
    create
      .mockResolvedValueOnce(respuesta([{ name: 'entregar_respuesta', args: { bloques: 'mal' } }]))
      .mockResolvedValueOnce(respuesta([{ name: 'entregar_respuesta', args: { bloques: [1] } }]));
    let intento = 0;
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS,
      toolExecutor: async () => { intento++; return intento === 1 ? { success: false, result: null, error: 'bloques inválidos', durationMs: 1 } : { success: true, result: { ok: true }, durationMs: 1 }; },
      maxToolRounds: 5,
      terminalTools: ['entregar_respuesta'],
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.toolCalls).toHaveLength(2);
  });
});

// B16 — `finish_reason: 'length'` CON tool_calls se reportaba al modelo como
// "argumentos JSON inválidos": truncamiento disfrazado de ilegible.
describe('B16 — el truncamiento se detecta también cuando hay tool_calls', () => {
  beforeEach(() => { create.mockReset(); });

  it('length + tool_calls con args cortados → TruncatedError, no `args_parse`', async () => {
    create.mockResolvedValueOnce({
      choices: [{ finish_reason: 'length', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'entregar_respuesta', arguments: '{"bloques":[{"tipo":"tabla","filas":[["a",1],["b",' } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 900 }, model: 'm',
    });
    let ejecuciones = 0;
    const err = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS,
      toolExecutor: async () => { ejecuciones++; return { success: true, result: {}, durationMs: 1 }; },
      maxToolRounds: 5, maxTokens: 900,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PartialExecutionError);
    expect(err.cause?.name).toBe('TruncatedError');
    expect(String(err.message)).toContain('900 tokens');
    expect(ejecuciones).toBe(0);
    expect(err.partialToolCalls.some((t: { error?: string }) => t.error === 'args_parse')).toBe(false);
  });
});

// B17 — la caché de lectura entre rondas se llaveaba por prefijo de nombre y
// ninguna tool de los dos chats (`kpis_flota`, `metrica_negocio`, `bandeja`…)
// ni `estado_viaje` entraba: el reintento correctivo volvía a pegarle a la base.
describe('B17 — la caché de lectura cubre las tools declaradas y el prefijo estado_', () => {
  beforeEach(() => { create.mockReset(); });

  const pide = (name: string, n: number) => ({
    choices: [{ message: { content: null, tool_calls: [{ id: `c${n}`, type: 'function', function: { name, arguments: '{}' } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm',
  });
  const cierra = { choices: [{ message: { content: 'ok', tool_calls: [] } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'm' };
  const herramientas = (name: string) => [{ type: 'function' as const, function: { name, description: 'd', parameters: { type: 'object', properties: {} } } }];

  it('`kpis_flota` declarada en readOnlyTools se ejecuta UNA vez aunque el modelo la pida en dos rondas', async () => {
    create.mockResolvedValueOnce(pide('kpis_flota', 1)).mockResolvedValueOnce(pide('kpis_flota', 2)).mockResolvedValueOnce(cierra);
    let ejecuciones = 0;
    const r = await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: herramientas('kpis_flota'),
      toolExecutor: async () => { ejecuciones++; return { success: true, result: { gasto: 1 }, durationMs: 1 }; },
      maxToolRounds: 5,
      readOnlyTools: ['kpis_flota'],
    });
    expect(ejecuciones).toBe(1);
    expect(r.toolCalls).toHaveLength(2); // las dos llamadas quedan registradas, una de caché
  });

  it('`estado_viaje` entra por el prefijo nuevo sin declararla', async () => {
    create.mockResolvedValueOnce(pide('estado_viaje', 1)).mockResolvedValueOnce(pide('estado_viaje', 2)).mockResolvedValueOnce(cierra);
    let ejecuciones = 0;
    await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: herramientas('estado_viaje'),
      toolExecutor: async () => { ejecuciones++; return { success: true, result: {}, durationMs: 1 }; },
      maxToolRounds: 5,
    });
    expect(ejecuciones).toBe(1);
  });

  it('una tool NO declarada y sin prefijo de lectura sigue sin cachearse (control)', async () => {
    create.mockResolvedValueOnce(pide('bandeja', 1)).mockResolvedValueOnce(pide('bandeja', 2)).mockResolvedValueOnce(cierra);
    let ejecuciones = 0;
    await generateWithTools({
      role: 'chat', system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: herramientas('bandeja'),
      toolExecutor: async () => { ejecuciones++; return { success: true, result: {}, durationMs: 1 }; },
      maxToolRounds: 5,
    });
    expect(ejecuciones).toBe(2);
  });
});
