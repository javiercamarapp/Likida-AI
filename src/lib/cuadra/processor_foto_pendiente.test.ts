import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO REINCIDENTE (rendimiento) — "El protocolo de dos fotos
// sigue pagando visión completa en el acercamiento". `extraerComprobante` ya
// sabe fusionar dos fotos en UNA sola llamada de visión (`string[]`); lo que
// faltaba era que `processor.ts` las juntara, y cada foto llega en su propia
// invocación del webhook — no hay memoria compartida entre ellas sin algo
// como `foto_pendiente` (migración 0038).
//
// Esta prueba NO repite lo que `intake/ocr_varias_fotos.test.ts` ya cubre
// (que `extraerComprobante([a,b])` fusiona bien): mockea `extraerComprobante`
// como espía y verifica QUÉ le manda `processInbound` — uno o dos dataURLs,
// según haya o no compañera esperando — y que la invocación que se queda
// esperando nunca hace un segundo trabajo cuando la reclaman.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const extraerComprobante = vi.fn();
const tieneCodigoLegible = vi.fn();
const addGasto = vi.fn();
const downloadMediaAsDataUrl = vi.fn();
const guardarFotoPendiente = vi.fn();
const existeFotoPendiente = vi.fn();
const reclamarFotoPendiente = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: (...a: unknown[]) => tieneCodigoLegible(...a),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsDataUrl: (...a: unknown[]) => downloadMediaAsDataUrl(...a),
}));
vi.mock('@/lib/cuadra/conv', async (original) => ({
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
vi.mock('@/lib/cuadra/repo', () => ({
  // Sala de espera de comprobantes sin viaje (mig. 0040). Sin estas cuatro,
  // `getHuerfanos` llega `undefined` y el processor truena en el `.length`.
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => addGasto(...a),
  getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: (...a: unknown[]) => guardarFotoPendiente(...a),
  existeFotoPendiente: (...a: unknown[]) => existeFotoPendiente(...a),
  reclamarFotoPendiente: (...a: unknown[]) => reclamarFotoPendiente(...a),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
}));
vi.mock('@/lib/cuadra/config', () => ({
  getConfig: vi.fn(async () => ({ politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] } })),
}));
vi.mock('@/lib/cuadra/costos', () => ({
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

const fotoA = { from: '5219993700779', type: 'image' as const, mediaId: 'media-A', waMessageId: 'wa-A' };
const fotoB = { from: '5219993700779', type: 'image' as const, mediaId: 'media-B', waMessageId: 'wa-B' };

const GASTO_LEGIBLE = {
  gasto: { id: 'g1', concepto: 'diesel', monto: 500, fecha: '2026-08-01', ocrExtra: {} },
  costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
  legible: true,
};

beforeEach(() => {
  salientes.length = 0;
  runAgent.mockReset(); extraerComprobante.mockReset(); tieneCodigoLegible.mockReset();
  addGasto.mockReset(); downloadMediaAsDataUrl.mockReset();
  guardarFotoPendiente.mockReset(); existeFotoPendiente.mockReset(); reclamarFotoPendiente.mockReset();
  logger.warn.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  // Ventana de espera corta para que la prueba no tarde segundos reales.
  process.env.CUADRA_FOTO_PENDIENTE_HOLD_MS = '60';
  process.env.CUADRA_FOTO_PENDIENTE_POLL_MS = '15';
  downloadMediaAsDataUrl.mockImplementation(async (mediaId: string) => `data:image/jpeg;base64,${mediaId}`);
  extraerComprobante.mockResolvedValue(GASTO_LEGIBLE);
  addGasto.mockResolvedValue(undefined);
});

describe('processInbound — el ticket completo se ofrece en espera y se procesa solo si nadie llega', () => {
  it('sin código: se ofrece en espera; si nadie la reclama, se autorreclama y procesa SOLA (como hoy)', async () => {
    tieneCodigoLegible.mockResolvedValue(false);
    guardarFotoPendiente.mockResolvedValue('pend-1');
    existeFotoPendiente.mockResolvedValue(true); // nunca la reclama nadie: sigue esperando hasta el tope
    reclamarFotoPendiente.mockResolvedValue({ id: 'pend-1', mediaId: 'media-A' }); // se autorreclama al vencer

    await processInbound(fotoA);

    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    expect(extraerComprobante.mock.calls[0][0]).toBe('data:image/jpeg;base64,media-A'); // UNA sola foto, no array
    expect(addGasto).toHaveBeenCalledTimes(1);
  });

  it('sin código: si un acercamiento la reclama mientras espera, esta invocación NO hace nada más', async () => {
    tieneCodigoLegible.mockResolvedValue(false);
    guardarFotoPendiente.mockResolvedValue('pend-1');
    // Sigue existiendo en el primer sondeo, desaparece en el segundo: alguien la tomó.
    existeFotoPendiente.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await processInbound(fotoA);

    expect(extraerComprobante).not.toHaveBeenCalled();
    expect(addGasto).not.toHaveBeenCalled();
    expect(salientes).toHaveLength(0); // el acuse lo da la invocación del acercamiento, no esta
    expect(reclamarFotoPendiente).not.toHaveBeenCalled(); // no se autorreclama: ya no está
  });

  it('CON código: si hay un ticket completo esperando, se manda junto — UNA sola visión para el par', async () => {
    tieneCodigoLegible.mockResolvedValue(true);
    reclamarFotoPendiente.mockResolvedValue({ id: 'pend-1', mediaId: 'media-A' });

    await processInbound(fotoB);

    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    const imagenes = extraerComprobante.mock.calls[0][0];
    expect(imagenes).toEqual(['data:image/jpeg;base64,media-A', 'data:image/jpeg;base64,media-B']);
    expect(guardarFotoPendiente).not.toHaveBeenCalled(); // el acercamiento nunca se ofrece a sí mismo en espera
  });

  it('CON código: sin ticket completo esperando, se procesa SOLA (como hoy, sin batching)', async () => {
    tieneCodigoLegible.mockResolvedValue(true);
    reclamarFotoPendiente.mockResolvedValue(null); // nadie esperando

    await processInbound(fotoB);

    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    expect(extraerComprobante.mock.calls[0][0]).toBe('data:image/jpeg;base64,media-B');
  });

  // AUDITORÍA 8: el riesgo real de este arreglo. Dos tickets DISTINTOS sin
  // código del mismo viaje NO pueden esperar los dos a la vez: `extraerComprobante`
  // con dos fotos SIN código solo le paga visión a la primera y la SEGUNDA se
  // pierde entera. El unique de la 0038 hace que la segunda `guardarFotoPendiente`
  // devuelva null — la señal de "no esperes, procésate sola" — y este test prueba
  // que el código LA RESPETA: no intenta esperar de todos modos.
  it('dos tickets sin código a la vez: el segundo NO espera (unique ya ocupado) — se procesa de inmediato, sola', async () => {
    tieneCodigoLegible.mockResolvedValue(false);
    guardarFotoPendiente.mockResolvedValue(null); // ya había uno esperando en este viaje

    await processInbound(fotoB);

    expect(existeFotoPendiente).not.toHaveBeenCalled(); // nunca entra a esperar
    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    expect(extraerComprobante.mock.calls[0][0]).toBe('data:image/jpeg;base64,media-B');
    expect(addGasto).toHaveBeenCalledTimes(1); // el segundo ticket SÍ se registra, no se pierde
  });

  // Es una optimización de COSTO, no el camino del dinero: si `foto_pendiente`
  // falla (tabla sin migrar, RPC caída), la foto se procesa sola de todos
  // modos — nunca se pierde un comprobante por este mecanismo.
  it('fail-open: si guardarFotoPendiente falla, la foto se procesa SOLA de todos modos', async () => {
    tieneCodigoLegible.mockResolvedValue(false);
    guardarFotoPendiente.mockRejectedValue(new Error('foto_pendiente no existe todavía'));

    await processInbound(fotoA);

    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    expect(extraerComprobante.mock.calls[0][0]).toBe('data:image/jpeg;base64,media-A');
    expect(addGasto).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('foto.pendiente_error', expect.anything());
  });

  it('fail-open: si la espera falla a medio camino, se libera la propia fila y se procesa sola', async () => {
    tieneCodigoLegible.mockResolvedValue(false);
    guardarFotoPendiente.mockResolvedValue('pend-1');
    existeFotoPendiente.mockRejectedValue(new Error('blip transitorio'));
    reclamarFotoPendiente.mockResolvedValue({ id: 'pend-1', mediaId: 'media-A' });

    await processInbound(fotoA);

    expect(reclamarFotoPendiente).toHaveBeenCalledWith('t1', { id: 'pend-1' }); // liberó su propia fila
    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    expect(addGasto).toHaveBeenCalledTimes(1);
  });
});
