import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · WA-3 (ALTO) — apretar «No, corregir» no dejaba RASTRO de
// ninguna clase: un `logger.warn` que muere con la invocación, y un mensaje
// que mandaba al chofer con su oficina — la cual no tenía forma de enterarse
// de que él había dicho nada. Ni el panel ni el cuadre podían levantarlo,
// porque no había nada escrito en ningún lado.
//
// Ahora la fila queda marcada (`ocr_extra.montoDisputado`, sin tocar el
// monto: nadie dijo cuál es el bueno) y el texto solo lo AFIRMA si la marca
// de verdad se escribió.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const guardarHuerfano = vi.fn();
const getHuerfanos = vi.fn();
const resolverHuerfanos = vi.fn();
const marcarHuerfanosOfrecidos = vi.fn();
const getOpenViaje = vi.fn();
const getGastos = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const runAgent = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/likida/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH') }));
vi.mock('@/lib/likida/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
  ligaComprobante: vi.fn(),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: (...a: unknown[]) => getOpenViaje(...a),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  addGasto: (...a: unknown[]) => addGasto(...a),
  guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...a),
  getHuerfanos: (...a: unknown[]) => getHuerfanos(...a),
  resolverHuerfanos: (...a: unknown[]) => resolverHuerfanos(...a),
  marcarHuerfanosOfrecidos: (...a: unknown[]) => marcarHuerfanosOfrecidos(...a),
  getGastos: (...a: unknown[]) => getGastos(...a), updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false), gastoPorHash: vi.fn(async () => null),
  corregirFechaGasto: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false),
  reclamarFotoPendiente: vi.fn(async () => null),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, origen: 'Silao', destino: 'N. Laredo', fechaInicio: '2026-08-01' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base'); }),
}));
vi.mock('@/lib/likida/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
    validacion: { fechaToleranciaDiasAntes: 30 },
  })),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));
// Un PostgREST de mentira ENCADENABLE: este camino (texto con viaje abierto)
// pasa por varias lecturas antes del botón, y una cadena a medias las tumba
// con un «se me trabó» que no es el hallazgo.
vi.mock('@/lib/supabase/admin', () => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in',
                   'gt', 'gte', 'lt', 'lte', 'not', 'or', 'order', 'limit', 'range', 'contains']) {
    enlace[m] = () => enlace;
  }
  enlace.maybeSingle = async () => ({ data: null, error: null });
  enlace.single = async () => ({ data: null, error: null });
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(r);
  return {
    supabaseAdmin: () => ({
      from: () => enlace,
      rpc: async () => ({ data: null, error: null }),
      storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) },
    }),
  };
});
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const marcarMontoDisputado = vi.fn(async () => true);
vi.mock('@/lib/likida/gasto_correccion', () => ({
  marcarMontoDisputado: (...a: unknown[]) => marcarMontoDisputado(...(a as [])),
}));


const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((b.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const GASTO_ID = '11111111-2222-4333-8444-555555555555';
const boton = (id: string) => ({ from: '5219993700779', type: 'text' as const, text: id, waMessageId: `wa-${id}` });

beforeEach(() => {
  salientes.length = 0;
  for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                   marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante, runAgent, getGastos]) m.mockReset();
  marcarMontoDisputado.mockReset(); marcarMontoDisputado.mockResolvedValue(true);
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  getOpenViaje.mockResolvedValue('v1');
  getHuerfanos.mockResolvedValue([]);
  getGastos.mockResolvedValue([]);
  runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
});

describe('WA-3 · «No, corregir» deja constancia', () => {
  it('EL FALLO: la disputa se escribe en la fila del gasto, con tenant y gasto', async () => {
    await processInbound(boton(`mal:${GASTO_ID}`));
    expect(marcarMontoDisputado).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', gastoId: GASTO_ID, quien: 'o1' }));
  });

  it('y se le dice que quedó marcado — pero solo porque de verdad quedó', async () => {
    await processInbound(boton(`mal:${GASTO_ID}`));
    const m = salientes.join(' ');
    expect(m).toMatch(/marqué para que tu oficina lo revise/i);
    expect(m, 'la trampa vieja: mandar otra foto lo cobra dos veces').toMatch(/no me mandes otra foto/i);
  });

  it('si la marca NO se pudo escribir, NO se le afirma que quedó marcada', async () => {
    marcarMontoDisputado.mockResolvedValue(false);
    await processInbound(boton(`mal:${GASTO_ID}`));
    const m = salientes.join(' ');
    expect(m).not.toMatch(/marqué/i);
    expect(m, 'lo que entonces sí funciona').toMatch(/enséñaselo a tu oficina/i);
  });

  it('«Sí, está bien» no marca nada: no hay disputa que anotar', async () => {
    await processInbound(boton(`ok:${GASTO_ID}`));
    expect(marcarMontoDisputado).not.toHaveBeenCalled();
  });

  it('el agente no corre por un botón: es una respuesta a una pregunta nuestra', async () => {
    await processInbound(boton(`mal:${GASTO_ID}`));
    expect(runAgent).not.toHaveBeenCalled();
  });
});
