import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El CABLEADO de los hitos (0090) en el dispatcher — lo que la unidad de
// hitos_viaje.test.ts no puede probar: que "ya llegué" se atiende ANTES del
// freno de cierre (cuyo regex ^(listo|ya|...) se lo comería) y que "listo"
// sigue siendo del cierre, no de los hitos.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const resolveOperador = vi.fn();
const sellarHito = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/hitos_viaje', async (original) => ({
  // El matcher y el acuse son los REALES: lo mockeado es solo el sello (DB).
  ...(await original<Record<string, unknown>>()),
  sellarHito: (...a: unknown[]) => sellarHito(...a),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
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

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

function msg(text: string) {
  return { from: '5219993700779', type: 'text' as const, text, waMessageId: `wa-${text.slice(0, 8)}` };
}

describe('processInbound — los hitos del chofer, cableados', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); sellarHito.mockReset();
    resolveOperador.mockResolvedValue({ tenantId: 't1', operadorId: 'o1' });
    sellarHito.mockResolvedValue('sellado');
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('"ya llegué" sella la llegada y NO cae al freno de cierre ni al agente', async () => {
    await processInbound(msg('ya llegué'));
    expect(sellarHito).toHaveBeenCalledWith('t1', 'v1', 'llegada', expect.any(Date));
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/Anotado: llegaste a las \d{2}:\d{2}/);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('"descargando" sella la descarga con su acuse', async () => {
    await processInbound(msg('descargando'));
    expect(sellarHito).toHaveBeenCalledWith('t1', 'v1', 'descarga', expect.any(Date));
    expect(salientes[0]).toMatch(/descargando desde las/);
  });

  it('el hito repetido no miente con una hora nueva', async () => {
    sellarHito.mockResolvedValue('ya_estaba');
    await processInbound(msg('voy de regreso'));
    expect(salientes[0]).toMatch(/Ya lo tenía anotado/);
  });

  it('"listo" sigue siendo del CIERRE: ningún hito se sella', async () => {
    await processInbound(msg('listo'));
    expect(sellarHito).not.toHaveBeenCalled();
    // El freno de cierre contesta (pregunta si va sin comprobantes) — lo que
    // importa aquí es que el mensaje NO se lo comió el módulo de hitos.
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).not.toMatch(/Anotado/);
  });

  it('el sello fallido se dice — no se finge la anotación', async () => {
    sellarHito.mockResolvedValue('fallo');
    await processInbound(msg('ya llegamos'));
    expect(salientes[0]).toMatch(/No pude anotarlo/);
  });
});
