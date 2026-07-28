import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// B21 — EL COSTO DE LOS INTENTOS QUE NO SIRVIERON.
//
// OpenRouter cobra la llamada aunque el JSON venga truncado o no valide. El
// `usage` ya viajaba dentro del error para eso... pero cuando el reintento sale
// bien, ese error se descarta y su consumo con él. Se reporta el costo de UN
// intento habiendo pagado dos, tres o cuatro.
//
// No es cosmético: Likida va a cobrar por liquidación. Un costo unitario
// subestimado se propaga directo al precio.
// ═══════════════════════════════════════════════════════════════════════════
const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));

process.env.OPENROUTER_API_KEY = 'test-key';
const { generateStructured, calcCost: calcCostReal } = await import('./openrouter');

const schema = z.object({ monto: z.number() });
const R = (finish: string, content: string, tokIn = 100, tokOut = 50) => ({
  choices: [{ finish_reason: finish, message: { content } }],
  usage: { prompt_tokens: tokIn, completion_tokens: tokOut },
  model: 'google/gemini-3.6-flash',
});
const llamar = () => generateStructured({
  role: 'ocr', system: 's', messages: [{ role: 'user', content: 'u' }], schema, schemaName: 'x',
});

describe('generateStructured — el costo suma TODOS los intentos', () => {
  beforeEach(() => { create.mockReset(); });

  it('un solo intento: el costo es el suyo', async () => {
    create.mockResolvedValue(R('stop', '{"monto":100}'));
    const r = await llamar();
    expect(r.tokensIn).toBe(100);
    expect(r.tokensOut).toBe(50);
    expect(r.cost).toBeGreaterThan(0);
  });

  it('truncado + reintento exitoso: se cobran DOS llamadas, se reportan dos', async () => {
    create
      .mockResolvedValueOnce(R('length', '{ "monto": 100', 100, 1184))
      .mockResolvedValueOnce(R('stop', '{"monto":507.65}', 100, 50));
    const r = await llamar();
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.tokensIn).toBe(200);          // 100 + 100
    expect(r.tokensOut).toBe(1234);        // 1184 + 50
  });

  it('JSON malo + reintento con nota: también suma los dos', async () => {
    create
      .mockResolvedValueOnce(R('stop', 'aquí va tu respuesta: no-json', 100, 40))
      .mockResolvedValueOnce(R('stop', '{"monto":42}', 120, 50));
    const r = await llamar();
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.tokensIn).toBe(220);
    expect(r.tokensOut).toBe(90);
  });

  it('el costo en pesos también acumula, no solo los tokens', async () => {
    create.mockResolvedValueOnce(R('stop', 'no-json', 100, 40)).mockResolvedValueOnce(R('stop', '{"monto":42}', 100, 40));
    const doble = await llamar();
    create.mockReset();
    create.mockResolvedValueOnce(R('stop', '{"monto":42}', 100, 40));
    const simple = await llamar();
    expect(doble.cost).toBeCloseTo(simple.cost * 2, 10);
  });

  it('cuando TODO falla, el error carga el consumo de todos los intentos', async () => {
    create.mockResolvedValue(R('stop', 'no-json', 100, 40));
    const err = await llamar().catch((e) => e);
    // 3 intentos: el primero, el de la nota, y el del fallback cross-provider.
    const usado = (err as { usage?: { tokensIn: number } }).usage;
    expect(usado, 'el error debe cargar el consumo acumulado').toBeDefined();
    expect(usado!.tokensIn).toBe(100 * create.mock.calls.length);
  });
});

describe('generateStructured — el camino del truncado también acumula', () => {
  beforeEach(() => { create.mockReset(); });

  it('truncado dos veces: el error carga las DOS llamadas, no solo la última', async () => {
    // Se relanza el TruncatedError tal cual para no disfrazar el diagnóstico
    // ("el problema es real, no lo pases por la escalera de formato malo") —
    // pero relanzarlo tal cual dejaba fuera el consumo del primer intento.
    create
      .mockResolvedValueOnce(R('length', '{ "monto": 1', 100, 1184))
      .mockResolvedValueOnce(R('length', '{ "monto": 1', 100, 2368));
    const err = await llamar().catch((e) => e);
    expect(create).toHaveBeenCalledTimes(2);
    const usado = (err as { usage?: { tokensIn: number; tokensOut: number } }).usage;
    expect(usado!.tokensIn).toBe(200);
    expect(usado!.tokensOut).toBe(3552);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIN AbortSignal, EL OCR CAE AL DEFAULT DEL SDK: 10 MINUTOS.
//
// El webhook tiene 60s y procesa el lote de mensajes con Promise.all en UNA
// invocación. El camino del "listo" ya está presupuestado, pero las ramas de
// foto no miraban el reloj y `generateStructured` ni siquiera aceptaba una
// señal: una foto lenta se lleva por delante la invocación entera, incluido el
// "listo" que sí venía bien medido. Y como Meta ya recibió su 200, no reintenta.
// ═══════════════════════════════════════════════════════════════════════════
describe('generateStructured — respeta el presupuesto de quien llama', () => {
  beforeEach(() => { create.mockReset(); });

  it('pasa el AbortSignal al SDK', async () => {
    create.mockResolvedValue(R('stop', '{"monto":100}'));
    const ac = new AbortController();
    await generateStructured({
      role: 'ocr', system: 's', messages: [{ role: 'user', content: 'u' }],
      schema, schemaName: 'x', signal: ac.signal,
    });
    // El SDK recibe la señal en el 2º argumento (RequestOptions), no en el body.
    expect(create.mock.calls[0][1]).toMatchObject({ signal: ac.signal });
  });

  it('sin señal no inventa una: el llamador decide', async () => {
    create.mockResolvedValue(R('stop', '{"monto":100}'));
    await generateStructured({ role: 'ocr', system: 's', messages: [{ role: 'user', content: 'u' }], schema, schemaName: 'x' });
    expect(create.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it('una señal ya abortada corta sin llamar al proveedor', async () => {
    // Si el presupuesto se agotó antes de empezar, no tiene sentido pagar la
    // llamada: se va a matar la función a media respuesta.
    create.mockResolvedValue(R('stop', '{"monto":100}'));
    const ac = new AbortController();
    ac.abort();
    await expect(generateStructured({
      role: 'ocr', system: 's', messages: [{ role: 'user', content: 'u' }],
      schema, schemaName: 'x', signal: ac.signal,
    })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UN MODELO SIN PRECIO NO CUESTA $0.
//
// `calcCost` devolvía 0 en silencio para cualquier slug que no estuviera en
// PRICES. Eso pasa de verdad: OpenRouter devuelve a veces el slug con sufijo de
// proveedor, y sobre todo pasa cada vez que se cambia de modelo y nadie se
// acuerda de la tabla. El resultado es una liquidación que parece gratis.
//
// Para un negocio que va a cobrar POR LIQUIDACIÓN, un costo unitario que se
// subestima en silencio es peor que uno que se equivoca ruidosamente.
// ═══════════════════════════════════════════════════════════════════════════
describe('calcCost — modelos sin precio', () => {
  it('los modelos conocidos cuestan lo que dice la tabla', () => {
    expect(calcCostReal('google/gemini-3.6-flash', 1_000_000, 0)).toBeGreaterThan(0);
  });

  it('un modelo DESCONOCIDO no devuelve 0 en silencio', () => {
    // Devuelve una estimación conservadora (la tarifa más cara conocida) para que
    // el costo se vea alto y alguien lo mire, en vez de invisible.
    const c = calcCostReal('proveedor/modelo-que-nadie-registró', 1_000_000, 1_000_000);
    expect(c).toBeGreaterThan(0);
  });

  it('tolera el sufijo de proveedor que a veces devuelve OpenRouter', () => {
    // "google/gemini-3.6-flash:nitro" es el mismo modelo y el mismo precio.
    const base = calcCostReal('google/gemini-3.6-flash', 500_000, 100_000);
    expect(calcCostReal('google/gemini-3.6-flash:nitro', 500_000, 100_000)).toBe(base);
  });
});
