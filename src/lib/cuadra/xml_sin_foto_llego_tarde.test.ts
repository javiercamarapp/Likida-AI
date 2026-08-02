import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO (agéntico) — "Hay una variante peor por el otro lado: si
// el XML llega SIN foto previa, la rama crea el gasto con `addGasto` SIN
// try/catch. Con la liquidación ya emitida eso lanza CU001, salta al catch
// general y el operador recibe 'se me trabó tantito' — un mensaje falso para
// una situación que no es transitoria."
//
// `xml_llego_tarde.test.ts` ya cubre la rama de MATCH (`updateGastoCfdiXml`).
// Esta cubre la rama SIN match: el XML llega antes que cualquier foto y crea
// el gasto de cero.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const addGasto = vi.fn();
const getGastos = vi.fn();
const downloadMediaAsText = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
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
  getGastos: (...a: unknown[]) => getGastos(...a),
  updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false), reclamarFotoPendiente: vi.fn(async () => null),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/cuadra/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
  })),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsText: (...a: unknown[]) => downloadMediaAsText(...a),
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

const xmlDoc = { from: '5219993700779', type: 'document' as const, mediaId: 'media1', waMessageId: 'wa1' };

const XML_VALIDO = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Total="1000.00" SubTotal="862.07" FormaPago="03"><cfdi:Emisor Rfc="PEM850101AAA"/><cfdi:Receptor Rfc="TRA850101AB1"/><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Impuesto="002" Importe="137.93"/></cfdi:Traslados></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d"/></cfdi:Complemento></cfdi:Comprobante>`;

describe('processInbound — el XML sin foto previa que llega tarde avisa la verdad', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); addGasto.mockReset(); getGastos.mockReset(); downloadMediaAsText.mockReset();
    logger.warn.mockReset(); logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    downloadMediaAsText.mockResolvedValue(XML_VALIDO);
    getGastos.mockResolvedValue([]); // sin ticket previo que emparejar: crea de cero
  });

  it('con CU001 (la 0036), avisa que llegó tarde y NO lo trata como error genérico', async () => {
    const err = new Error('el viaje ya tiene liquidación emitida') as Error & { code?: string };
    err.code = 'CU001';
    addGasto.mockRejectedValue(err);

    await processInbound(xmlDoc);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/llegó después de que cerré tu liquidación/i);
    expect(salientes[0], 'un XML que llega tarde no es "se me trabó": es un hecho fiscal').not.toMatch(/se me trabó/i);
  });

  it('con un error normal, sigue cayendo al mensaje genérico (no se traga el catch)', async () => {
    addGasto.mockRejectedValue(new Error('fallo de red cualquiera'));

    await processInbound(xmlDoc);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/se me trabó/i);
  });

  it('control: si el addGasto SÍ funciona, no avisa nada de "llegó tarde"', async () => {
    addGasto.mockResolvedValue(undefined);

    await processInbound(xmlDoc);

    expect(salientes.join(' ')).not.toMatch(/llegó después de que cerré/i);
  });
});
