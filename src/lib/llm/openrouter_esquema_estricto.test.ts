import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// T-A3-68 (a) — el 400 del esquema estricto no se traga en silencio.
//
// La prueba con modelos reales (16-oct-2026) mostró que los dos Gemini del extractor de Carta Porte responden HTTP 400
// (INVALID_ARGUMENT) a `response_format: json_schema, strict`. Aquí las respuestas son SINTÉTICAS, de la forma del error
// del proveedor y de la salida; no hay datos reales ni llamadas a ningún modelo.
// ═══════════════════════════════════════════════════════════════════════════

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));
process.env.OPENROUTER_API_KEY = 'test-key';

const Esquema = z.object({ campos: z.array(z.object({ clave: z.string(), valor: z.string().nullable() })), notas: z.string().nullable() });
const salidaOk = (model: string) => ({
  model, choices: [{ message: { content: JSON.stringify({ campos: [{ clave: 'folio_cliente', valor: 'X1' }], notas: null }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 },
});
/** La forma del error del proveedor (OpenRouter → Gemini): HTTP 400, «Provider returned error», INVALID_ARGUMENT. */
const error400 = () => Object.assign(new Error('400 Provider returned error'), {
  status: 400, error: { message: 'Provider returned error', code: 400, metadata: { raw: '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}' } },
});
const formatoDe = (llamada: number) => (create.mock.calls[llamada][0] as { response_format: { type: string } }).response_format.type;

const llamar = async (rol: 'cartaporte_extractor' | 'cartaporte_extractor_escala2', onCaida?: (c: unknown) => void) => {
  const { generateStructured } = await import('./openrouter');
  return generateStructured({ role: rol, system: 'SISTEMA', messages: [{ role: 'user', content: 'doc' }], schema: Esquema, schemaName: 'x', onCaida });
};

beforeEach(async () => {
  create.mockReset();
  const { reiniciarCaidas } = await import('./caidas');
  reiniciarCaidas();
});

describe('modelos que NO admiten el esquema estricto (medido): json_object desde la primera llamada', () => {
  it('gemini-3.5-flash-lite pide json_object con el esquema en el prompt y se registra el cambio de modo', async () => {
    create.mockResolvedValueOnce(salidaOk('google/gemini-3.5-flash-lite'));
    const avisos: unknown[] = [];
    const r = await llamar('cartaporte_extractor', (c) => avisos.push(c));
    expect(r.data.campos[0].valor).toBe('X1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(formatoDe(0)).toBe('json_object');
    const sistema = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(sistema).toContain('JSON Schema');
    expect(sistema).toContain('"campos"');
    expect(avisos).toEqual([expect.objectContaining({ tipo: 'modo_json', motivo: 'modelo_sin_esquema_estricto', de: 'google/gemini-3.5-flash-lite' })]);
    const { contadoresDeCaidas } = await import('./caidas');
    expect(contadoresDeCaidas()['modo_json:modelo_sin_esquema_estricto:google/gemini-3.5-flash-lite']).toBe(1);
  });

  it('la salida en json_object se valida con NUESTRO zod: una salida que no cumple el esquema no pasa', async () => {
    const mala = { model: 'google/gemini-3.5-flash-lite', choices: [{ message: { content: '{"campos":"no es lista","notas":null}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } };
    create.mockResolvedValue(mala);
    await expect(llamar('cartaporte_extractor')).rejects.toThrow(/Validación falló/);
  });
});

describe('un modelo que sí era estricto y recibe el 400: se repite con json_object, se registra y se aprende', () => {
  it('el 400 NO se pierde ni cae a un respaldo: segunda llamada en json_object, misma llamada lógica', async () => {
    create.mockRejectedValueOnce(error400());
    create.mockResolvedValueOnce(salidaOk('anthropic/claude-sonnet-5.5'));
    const avisos: Array<{ tipo: string; motivo: string }> = [];
    const r = await llamar('cartaporte_extractor_escala2', (c) => avisos.push(c as { tipo: string; motivo: string }));
    expect(r.data.campos).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect([formatoDe(0), formatoDe(1)]).toEqual(['json_schema', 'json_object']);
    expect(avisos).toEqual([expect.objectContaining({ tipo: 'modo_json', motivo: 'esquema_estricto_rechazado' })]);
    const { contadoresDeCaidas } = await import('./caidas');
    expect(contadoresDeCaidas()['modo_json:esquema_estricto_rechazado:anthropic/claude-sonnet-5.5']).toBe(1);
  });

  it('lo aprendido se recuerda: la llamada siguiente ya va en json_object sin gastar otro intento en el 400', async () => {
    create.mockRejectedValueOnce(error400());
    create.mockResolvedValue(salidaOk('anthropic/claude-sonnet-5.5'));
    await llamar('cartaporte_extractor_escala2');
    create.mockClear();
    await llamar('cartaporte_extractor_escala2');
    expect(create).toHaveBeenCalledTimes(1);
    expect(formatoDe(0)).toBe('json_object');
  });

  it('un 401 (llave rota) NO se disfraza de problema de esquema: no se repite en json_object', async () => {
    create.mockRejectedValue(Object.assign(new Error('401 unauthorized'), { status: 401 }));
    await expect(llamar('cartaporte_extractor_escala2')).rejects.toThrow();
    // Solo los dos intentos de siempre (original y con nota), ambos en modo estricto.
    expect(create.mock.calls.every((_, i) => formatoDe(i) === 'json_schema')).toBe(true);
  });

  it('un modelo estricto que responde bien no deja caída alguna', async () => {
    create.mockResolvedValueOnce(salidaOk('anthropic/claude-sonnet-5.5'));
    const avisos: unknown[] = [];
    await llamar('cartaporte_extractor_escala2', (c) => avisos.push(c));
    expect(avisos).toEqual([]);
    expect(formatoDe(0)).toBe('json_schema');
  });
});

describe('la caída al respaldo por un proveedor caído también se cuenta con su motivo', () => {
  it('dos fallos transitorios del primario → respaldo, con registro y aviso', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('upstream'), { status: 503 }));
    create.mockRejectedValueOnce(Object.assign(new Error('upstream'), { status: 503 }));
    create.mockResolvedValueOnce(salidaOk('openai/gpt-5.6-luna'));
    const avisos: Array<{ tipo: string; a: string }> = [];
    await llamar('cartaporte_extractor_escala2', (c) => avisos.push(c as { tipo: string; a: string }));
    expect(avisos.find((a) => a.tipo === 'respaldo')?.a).toBe('openai/gpt-5.6-luna');
    const { contadoresDeCaidas } = await import('./caidas');
    expect(contadoresDeCaidas()['respaldo:proveedor_transitorio:anthropic/claude-sonnet-5.5']).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T-SYS-27 — el campo raíz del 400: `SalidaLlmSchema` (extractor de A3) declaraba `maxItems` en tres arrays
// (`campos`, `mercancias` y los `campos` de cada mercancía). La prueba con modelos reales (16-oct) achacó el 400 de
// los dos Gemini al esquema estricto; aquí se prueba, con el esquema REAL de A3 (sin tocar `caidas.ts` ni la lista
// `MODELOS_SIN_ESQUEMA_ESTRICTO`, fuera de alcance de esta tarea), que un modelo que SÍ intenta el modo estricto
// (nivel 3, Sonnet — los dos Gemini ya estaban exceptuados por esa lista y por eso no sirven para esta prueba)
// recibe el 400 mientras el esquema declare `maxItems`, y responde en una sola llamada en cuanto se quita.
// ═══════════════════════════════════════════════════════════════════════════
describe('T-SYS-27: SalidaLlmSchema (A3) sin `maxItems` — el campo que tumbaba el esquema estricto con 400', () => {
  it('el esquema JSON que ve el modelo no declara `maxItems` en ningún array', async () => {
    const { SalidaLlmSchema } = await import('../likida/carta_porte_docs/extractor');
    const texto = JSON.stringify(z.toJSONSchema(SalidaLlmSchema, { target: 'draft-7' }));
    expect(texto).not.toContain('maxItems');
  });

  it('con el esquema real de A3, un modelo que intenta el modo estricto responde en UNA sola llamada, sin caer a json_object', async () => {
    const { SalidaLlmSchema } = await import('../likida/carta_porte_docs/extractor');
    const textoEsquema = JSON.stringify(z.toJSONSchema(SalidaLlmSchema, { target: 'draft-7' }));
    // El mock modela lo medido con el proveedor real: un intento estricto (`json_schema`) con `maxItems` en el
    // esquema recibe 400; sin `maxItems` responde bien a la primera. No se mockea por rol ni por modelo — se
    // decide SOLO por lo que de verdad declara el esquema, para que esta prueba sea roja hoy y verde tras el fix.
    create.mockImplementation(async (body: { response_format?: { type?: string } }) => {
      if (body.response_format?.type === 'json_schema' && textoEsquema.includes('maxItems')) throw error400();
      return salidaCartaPorteOk();
    });
    const avisos: unknown[] = [];
    const { generateStructured } = await import('./openrouter');
    // Nivel 3 (Sonnet, `cartaporte_extractor_escala2`) a propósito: los dos Gemini de los niveles 1 y 2 ya están en
    // `MODELOS_SIN_ESQUEMA_ESTRICTO` (T-A3-68 a) y por eso SIEMPRE usan `json_object` sin intentar el modo
    // estricto — esa lista es la cascada ya integrada y no se toca aquí. Sonnet sí intenta el modo estricto primero,
    // así que es el que deja ver, sin tocar nada más, si el 400 viene del esquema.
    const r = await generateStructured({
      role: 'cartaporte_extractor_escala2', system: 'SISTEMA', messages: [{ role: 'user', content: 'doc' }],
      schema: SalidaLlmSchema, schemaName: 'carta_porte_extraccion', onCaida: (c) => avisos.push(c),
    });
    expect(r.data.campos[0]?.valor).toBe('44100');
    expect(create).toHaveBeenCalledTimes(1);
    expect(avisos).toEqual([]);
  });
});

const salidaCartaPorteOk = () => ({
  model: 'anthropic/claude-sonnet-5.5',
  choices: [{ message: { content: JSON.stringify({ campos: [{ clave: 'origen_cp', valor: '44100', confianza: 0.9, evidencia: 'x' }], mercancias: [], notas: null }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 },
});
