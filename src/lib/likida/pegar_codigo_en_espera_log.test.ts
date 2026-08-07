import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, ALTO operabilidad — el catch de `pegarCodigoEnEspera`
// (processor.ts) registraba `foto.pendiente_error` con SOLO `{ err }`, aunque
// `tenantId`, `viajeId` y `gasto.id` están en scope y las líneas vecinas los
// usan. Sentry agrupa por `msg`: sin estos campos, un fallo aquí no se puede
// cruzar contra la base para saber a qué viaje o tenant pertenece.
//
// (El hallazgo original también decía que este `msg` colisionaba con el del
// mecanismo `foto_pendiente`/mig. 0038 — ese mecanismo se revirtió esta misma
// ronda, así que la colisión ya no existe. Lo que sí seguía existiendo, y es
// lo que prueba este archivo, es que ESTE sitio por su cuenta no traía
// contexto suficiente.)
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const extraerComprobante = vi.fn();
const getGastos = vi.fn();
const getCodigosPendientes = vi.fn();
const addGasto = vi.fn();
const subirComprobante = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => addGasto(...a),
  corregirFechaGasto: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false),
  gastoPorHash: vi.fn(async () => null),
  getGastos: (...a: unknown[]) => getGastos(...a),
  updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(),
  guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: (...a: unknown[]) => getCodigosPendientes(...a),
  reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, fechaInicio: '2026-08-01' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
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

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: 'wa1' };

describe('processInbound — pegarCodigoEnEspera deja rastro con viaje/tenant/gasto', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [runAgent, extraerComprobante, getGastos, getCodigosPendientes, addGasto, subirComprobante]) m.mockReset();
    logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    getGastos.mockResolvedValue([]);
    addGasto.mockResolvedValue(undefined);
    subirComprobante.mockResolvedValue('t1/v1/HASH.jpg');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
    extraerComprobante.mockResolvedValue({
      legible: true,
      // Sin folioPortal/codigoBarras: pegarCodigoEnEspera no puede salir por
      // el `return` temprano y llega a consultar la bandeja. `id` presente
      // porque la función real (ocr.ts) siempre lo asigna con randomUUID().
      gasto: { id: 'g-diesel', concepto: 'diesel', monto: 850, fecha: '2026-08-01', folio: 'A1', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
  });

  it('un fallo al leer la bandeja de códigos pendientes se registra con viaje, tenant y gasto', async () => {
    getCodigosPendientes.mockRejectedValue(new Error('fetch failed'));

    await processInbound(foto);

    expect(logger.warn).toHaveBeenCalledWith('foto.pendiente_error', expect.objectContaining({
      viaje: 'v1', tenant: 't1', gasto: 'g-diesel',
    }));
  });

  it('el gasto SIGUE entrando aunque la bandeja falle — best-effort, no tumba el alta', async () => {
    getCodigosPendientes.mockRejectedValue(new Error('fetch failed'));

    await processInbound(foto);

    expect(addGasto).toHaveBeenCalled();
  });
});
