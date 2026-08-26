// ═══════════════════════════════════════════════════════════════════════════
// LOS CANDADOS DEL ADAPTADOR QUE OPERA PORTALES NO ESCRITOS.
//
// Un modelo conduciendo el formulario de un portal fiscal puede hacer tres
// daños irreversibles, y los tres se prueban aquí SIN red, SIN portal y SIN
// llamar a ningún modelo: el ciclo del LLM se sustituye por un guion de tool
// calls, que es exactamente lo que un modelo devolvería.
//
// Se prueba lo que el código GARANTIZA, no lo que el prompt PIDE. Un candado
// que depende de que el modelo obedezca no es un candado, y una prueba que
// verifica el texto del prompt no prueba nada.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import type { ToolExecutor } from '@/lib/llm/openrouter';

/** Lo que el adaptador le pasó al ciclo del LLM en la última corrida. */
let capturadoTools: OpenAI.Chat.ChatCompletionTool[] = [];
let capturadoExecutor: ToolExecutor | null = null;
/** El guion: lo que el "modelo" decide llamar, en orden. */
let guion: Array<{ tool: string; args: Record<string, unknown> }> = [];
let textoFinal = '';

vi.mock('@/lib/llm/openrouter', () => ({
  generateWithTools: vi.fn(async (opts: {
    tools: OpenAI.Chat.ChatCompletionTool[]; toolExecutor: ToolExecutor;
  }) => {
    capturadoTools = opts.tools;
    capturadoExecutor = opts.toolExecutor;
    for (const paso of guion) await opts.toolExecutor(paso.tool, paso.args);
    return {
      finalText: textoFinal, toolCalls: guion.map((g) => ({ toolName: g.tool })),
      model: 'x', tokensIn: 0, tokensOut: 0, cost: 0, costoPorModelo: {},
    };
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { AdaptadorComputerUse, extraerUuid } = await import('./computer_use');

/**
 * Las tools de tipo `function`, ya estrechadas.
 *
 * `ChatCompletionTool` es una UNIÓN en el SDK que fija el lockfile
 * (`function` | `custom`), así que `.function` no existe sobre la unión. Se
 * estrecha por el discriminante en vez de castear: un cast habría compilado y
 * reventado en tiempo de ejecución el día que llegue una tool `custom`.
 */
type ToolFuncion = Extract<OpenAI.Chat.ChatCompletionTool, { type: 'function' }>;
const funciones = (ts: OpenAI.Chat.ChatCompletionTool[]): ToolFuncion[] =>
  ts.filter((t): t is ToolFuncion => t.type === 'function');
const nombresDeTools = () => funciones(capturadoTools).map((t) => t.function.name);

/** Lo que el adaptador de verdad le hizo a la página. */
const escrito: Array<[string, string]> = [];
const clicado: string[] = [];

/** Una página falsa con las mismas manos que la real. */
const paginaFalsa = () => ({
  abrir: vi.fn(async () => {}),
  escribir: vi.fn(async (s: string, v: string) => { escrito.push([s, v]); }),
  seleccionar: vi.fn(async (s: string, v: string) => { escrito.push([s, v]); }),
  hacerClic: vi.fn(async (s: string) => { clicado.push(s); }),
  captura: vi.fn(async () => 'captura.jpg'),
  cerrar: vi.fn(async () => {}),
  pagina: { evaluate: vi.fn(async () => ({ campos: [], botones: [], texto: '' })) },
});

const RECEPTOR = {
  rfc: 'GMX0902279I1', nombre: 'G3M', codigoPostal: '97000',
  regimenFiscal: '601', usoCfdi: 'G03', correo: 'a@b.mx',
};
const CAMPOS = [{ clave: 'webId' as const, etiqueta: 'WebID', valor: '5498441008183', requerido: true }];

const armar = () => new AdaptadorComputerUse({
  comercio: 'megasur', portal: 'http://portal.example/',
  receptor: RECEPTOR,
  abrirPagina: async () => paginaFalsa() as never,
});

beforeEach(() => {
  escrito.length = 0; clicado.length = 0;
  guion = []; textoFinal = ''; capturadoTools = []; capturadoExecutor = null;
});

describe('el modelo NO puede inventar un dato fiscal', () => {
  it('una clave que no existe se rechaza y NO llega a la página', async () => {
    // Un modelo alucinando un RFC es el peor error posible de este producto:
    // acaba impreso en un CFDI irreversible.
    guion = [{ tool: 'escribir', args: { selector: '#rfc', clave: 'rfcDelCliente' } }];
    await armar().facturar(CAMPOS, 'ensayo');

    expect(escrito, 'nada debió escribirse').toHaveLength(0);
  });

  it('`escribir` solo acepta CLAVES, y el valor lo pone el sistema', async () => {
    guion = [{ tool: 'escribir', args: { selector: '#rfc', clave: 'rfc' } }];
    await armar().facturar(CAMPOS, 'ensayo');

    expect(escrito).toEqual([['#rfc', 'GMX0902279I1']]);
    // Y el esquema de la tool lo fija: `clave` es un enum cerrado, así que un
    // valor libre ni siquiera se puede expresar en la llamada.
    const escribir = funciones(capturadoTools).find((t) => t.function.name === 'escribir');
    const clave = (escribir?.function.parameters as { properties: { clave: { enum: string[] } } }).properties.clave;
    expect(clave.enum).toContain('webId');
    expect(clave.enum).not.toContain('monto'); // no se ofreció, no existe
  });
});

describe('el botón de emitir', () => {
  it('en ENSAYO la herramienta ni siquiera se le ofrece al modelo', async () => {
    await armar().facturar(CAMPOS, 'ensayo');
    // No es que se le pida que no la use: no está en su lista.
    expect(nombresDeTools()).not.toContain('emitir');
  });

  it('en EMITIR sí existe', async () => {
    await armar().facturar(CAMPOS, 'emitir');
    expect(nombresDeTools()).toContain('emitir');
  });

  it('si se emitió y no hay UUID, se declara `emisionSinConfirmar`', async () => {
    // La señal más cara: sin ella el ticket vuelve a la cola y se emite un
    // SEGUNDO CFDI por el mismo consumo.
    guion = [{ tool: 'emitir', args: { selector: '#facturar' } }];
    const r = await armar().facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.emisionSinConfirmar).toBe(true);
  });

  it('con UUID en la pantalla, se cobra como emitido', async () => {
    guion = [{ tool: 'emitir', args: { selector: '#facturar' } }];
    textoFinal = 'Listo, UUID B0800A68-8565-47D9-90E0-CDA7803C50E4';
    const r = await armar().facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(true);
    // ARQ-19C2-5: normalizado a minúsculas, igual que `repo.ts`.
    expect(r.cfdiUuid).toBe('b0800a68-8565-47d9-90e0-cda7803c50e4');
  });
});

describe('lo que no se toca nunca', () => {
  it('el checkbox de partidos políticos se niega, aunque el modelo insista', async () => {
    // Marcarlo convierte el CFDI en un donativo a un partido. Ya estaba
    // prohibido por nombre en el adaptador de CAPUFE; aquí se generaliza.
    guion = [{ tool: 'clic', args: { selector: '#checkPartidoPolitico' } }];
    await armar().facturar(CAMPOS, 'emitir');

    expect(clicado).toHaveLength(0);
  });

  it('CONTROL — un botón normal sí se aprieta', async () => {
    guion = [{ tool: 'clic', args: { selector: '#validar' } }];
    await armar().facturar(CAMPOS, 'ensayo');

    expect(clicado).toEqual(['#validar']);
  });
});

describe('rendirse dice POR QUÉ, y el captcha se declara aparte', () => {
  it('un captcha no es "no pude": es "no se puede", y sale marcado', async () => {
    // `requiereCaptcha` es lo que separa reintentar cada hora contra el mismo
    // muro, de mandarlo con una persona. Ver `pideCaptcha()` en agente.ts.
    guion = [{ tool: 'rendirse', args: { motivo: 'el portal pide CAPTCHA' } }];
    const r = await armar().facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.requiereCaptcha).toBe(true);
    expect(r.error).toMatch(/captcha/i);
  });

  it('rendirse por otra razón NO se marca como captcha', async () => {
    guion = [{ tool: 'rendirse', args: { motivo: 'el portal pide un dato que no tengo' } }];
    const r = await armar().facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.requiereCaptcha).toBeUndefined();
    expect(r.error).toContain('no tengo');
  });
});

describe('los <select> del portal', () => {
  it('se eligen por valor y quedan en `capturado`, que es lo que hace auditable el ensayo', async () => {
    guion = [{ tool: 'seleccionar', args: { selector: '#regimen', valor: '601' } }];
    const r = await armar().facturar(CAMPOS, 'ensayo');

    expect(escrito).toEqual([['#regimen', '601']]);
    expect(r.capturado['#regimen']).toBe('601');
  });
});

describe('un fallo del portal no revienta el ciclo', () => {
  it('vuelve como texto para que el modelo corrija, no como excepción', async () => {
    guion = [];
    await armar().facturar(CAMPOS, 'ensayo');
    const ejecutor = capturadoExecutor!;
    // Selector inexistente: la página real lanza. El ciclo tiene que sobrevivir.
    const r = await ejecutor('escribir', { selector: '#noExiste', clave: 'rfc' });
    expect(r).toHaveProperty('durationMs');
  });
});

describe('extraerUuid', () => {
  // ARQ-19C2-5: `repo.ts` normaliza a MINÚSCULAS antes de comparar/guardar
  // (`.toLowerCase()`) — este adaptador debe entregar el mismo formato.
  it('lo encuentra donde sea y lo normaliza a minúsculas', () => {
    expect(extraerUuid('folio B0800A68-8565-47D9-90E0-CDA7803C50E4 ok'))
      .toBe('b0800a68-8565-47d9-90e0-cda7803c50e4');
  });
  it('sin UUID devuelve null en vez de inventar uno', () => {
    expect(extraerUuid('se emitió correctamente')).toBeNull();
  });
});
