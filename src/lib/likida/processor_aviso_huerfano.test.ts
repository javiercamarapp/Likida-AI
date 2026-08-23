import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 3, LEG-C1 (CRÍTICO, reincidente): la rama "sin viaje abierto"
// descargaba la foto y la mandaba al modelo de visión ANTES del gate del
// aviso de privacidad — el primer contacto real de un chofer nuevo son once
// fotos sin viaje, tratadas con aviso_privacidad_en = NULL. El gate se izó
// arriba de TODA la rama; estas pruebas fijan que sin aviso NO hay OCR ni
// huérfano guardado, y que con aviso puesto la foto SÍ se conserva.
// ═══════════════════════════════════════════════════════════════════════════

const extraerComprobante = vi.fn();
const guardarHuerfano = vi.fn(async (..._a: unknown[]) => true);
const getDatosResponsable = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/likida/intake/ocr', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
}));
vi.mock('@/lib/likida/intake/hash', () => ({ hashImagen: vi.fn(async () => 'hash-1') }));
vi.mock('@/lib/likida/intake/almacen', () => ({
  subirComprobante: vi.fn(async () => null), urlFirmada: vi.fn(async () => null),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,Zm90bw=='),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => null), // SIN viaje abierto: la rama del hallazgo
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []),
  guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...a),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: (...a: unknown[]) => getDatosResponsable(...a),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => null),
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

const FOTO = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa-foto' };

describe('processInbound — la foto huérfana queda DETRÁS del aviso (LEG-C1)', () => {
  beforeEach(() => {
    salientes.length = 0;
    extraerComprobante.mockReset().mockResolvedValue({
      legible: true,
      gasto: { id: 'g1', concepto: 'diesel', monto: 500, fecha: '2026-08-14', ocrConfianza: 0.95 },
      costo: { modelo: 'vision-test', tokensIn: 10, tokensOut: 10, costoUsd: 0.001 },
    });
    guardarHuerfano.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('SIN aviso posible (flota sin datos): NI visión NI huérfano — cero tratamiento', async () => {
    getDatosResponsable.mockResolvedValue(null); // → ponerAvisoADisposicion: sin_datos
    await processInbound(FOTO);
    expect(extraerComprobante).not.toHaveBeenCalled();
    expect(guardarHuerfano).not.toHaveBeenCalled();
    expect(salientes.join(' ')).toMatch(/aviso de privacidad/i);
  });

  it('con el aviso puesto, la foto sin viaje SÍ se procesa y se conserva (el camino bueno intacto)', async () => {
    getDatosResponsable.mockResolvedValue({
      razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
    });
    await processInbound(FOTO);
    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    expect(guardarHuerfano).toHaveBeenCalledTimes(1);
  });
});
