import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO (rubro agéntico) — el aviso de barrera vencida mandaba al
// operador a hacer algo que la migración 0036 acaba de prohibir.
//
// Cuando la barrera de intake vence, el turno cierra igual y el aviso decía
// "reenvíalo y escribe *listo* otra vez" — un consejo válido cuando reenviar
// funcionaba. Con la liquidación YA emitida (0036), las dos instrucciones son
// imposibles: reenviar truena con `trg_gasto_no_tras_liquidar`, y "listo" ya
// no encuentra viaje abierto. El operador queda con $X suyos y ningún camino
// de vuelta desde WhatsApp.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const getGastos = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  // `cierreSinComprobantes: true` deja pasar el freno de "cierre sin
  // comprobantes" (processor.ts): este archivo prueba el aviso de barrera
  // vencida, no ese freno, y con `false` el "listo" nunca llegaba al agente.
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [], cierreSinComprobantes: true })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  // La barrera VENCE a propósito: es la condición que dispara el aviso.
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => false),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  // Sala de espera de comprobantes sin viaje (mig. 0040). Sin estas cuatro,
  // `getHuerfanos` llega `undefined` y el processor truena en el `.length`.
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: (...a: unknown[]) => getGastos(...a), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

describe('el aviso de barrera vencida, con la liquidación YA cerrada', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); getGastos.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    getGastos.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }, { id: 'g4' }, { id: 'g5' }]);
  });

  it('NO le dice al operador que reenvíe y escriba "listo" otra vez', async () => {
    runAgent.mockResolvedValue({
      finalText: 'Listo, cuadré tu viaje 👇', model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
      toolCalls: [{ toolName: 'guardar_liquidacion', error: undefined, result: { liquidacion_id: 'L1', pdf_generado: false } }],
    });
    await processInbound(listo);
    const avisoBarrera = salientes.find((s) => /alcancé a procesar/.test(s));
    expect(avisoBarrera, 'debe seguir avisando que faltó algo').toBeTruthy();
    expect(avisoBarrera, 'ya no puede pedir reenviar: la 0036 lo rechaza').not.toMatch(/reenvíalo y escribe \*?listo\*? otra vez/i);
    expect(avisoBarrera).toMatch(/siguiente viaje|oficina/i);
  });

  it('con el viaje TODAVÍA abierto, el consejo de reenviar sigue siendo válido', async () => {
    runAgent.mockResolvedValue({
      finalText: '¿Cuánto llevo?', model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
      toolCalls: [], // no cerró nada — closed = false
    });
    await processInbound(listo);
    const avisoBarrera = salientes.find((s) => /⚠️/.test(s));
    expect(avisoBarrera, 'debe seguir avisando que faltó algo').toBeTruthy();
    expect(avisoBarrera).toMatch(/reenvíalo y escribe \*?listo\*?/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, MEDIO (rubro agéntico) — la primera mitad del aviso ("cuadré
// con los N comprobantes que alcancé a procesar") afirmaba un cuadre que, sin
// `closed`, no había pasado: el agente pudo contestar un saludo sin llamar
// ninguna tool, y el viaje sigue `abierto`. Es la misma clase de mentira que
// `guardiaEstado` existe para tapar, escrita fuera de su alcance.
// ═══════════════════════════════════════════════════════════════════════════
describe('el aviso de barrera vencida, con el viaje AÚN abierto', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); getGastos.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    getGastos.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }, { id: 'g4' }, { id: 'g5' }]);
  });

  it('NO afirma que cuadró cuando no llamó ninguna tool', async () => {
    runAgent.mockResolvedValue({
      finalText: 'Buenas tardes', model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
      toolCalls: [], // saludo, sin cuadrar_viaje ni guardar_liquidacion — closed = false
    });
    await processInbound(listo);
    const avisoBarrera = salientes.find((s) => /⚠️/.test(s));
    expect(avisoBarrera, 'debe seguir avisando que un comprobante tardó').toBeTruthy();
    expect(avisoBarrera, 'no puede afirmar un cuadre que no ocurrió').not.toMatch(/cuadré con/i);
    expect(avisoBarrera).toMatch(/todavía no cuadro nada/i);
  });
});
