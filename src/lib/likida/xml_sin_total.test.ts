import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD 22-ago-2026 · DAT-37 — UN CFDI SIN `@Total` ENTRABA COMO UN
// GASTO DE $0.00 CON `xml_verificado: true`.
//
// `monto: xml.total ?? 0` era la línea, y las dos mitades son malas por
// separado y peores juntas:
//
//   · el CERO se lee en la liquidación del contralor como una cifra medida
//     («caseta · $0.00»), y este producto tiene UNA regla que no se rompe:
//     nunca inventar una cifra;
//   · `xml_verificado` es exactamente la marca con la que el motor decide
//     contar litros y acreditar IVA/IEPS. Ponerla sobre un archivo del que no
//     se pudo leer el total es afirmar que se verificó lo que no se leyó.
//
// `@Total` es obligatorio en CFDI 4.0: si no viene, el archivo está roto o no
// es un CFDI. La evidencia SÍ se conserva (CFF 30 obliga a guardar el XML
// cinco años); lo que no se hace es inventarle un importe al papel.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const saveCfdiXmlRaw = vi.fn();
const parseCfdiXml = vi.fn();
const intakeDelta = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/likida/intake/cfdi_xml', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  parseCfdiXml: (...a: unknown[]) => parseCfdiXml(...a),
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
  releaseMessageClaim: vi.fn(), completarMessageClaim: vi.fn(),
  intakeDelta: (...a: unknown[]) => intakeDelta(...a), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => addGasto(...a),
  getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: (...a: unknown[]) => saveCfdiXmlRaw(...a),
  gastoExistePorHash: vi.fn(async () => false), gastoPorHash: vi.fn(async () => null),
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
vi.mock('@/lib/likida/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getConfig: vi.fn(async () => ({
    hidrocarburos: { claves: ['15101514'] },
    estimulos: { clavesPeaje: ['78111808'], peajeFactor: 0.5 },
  })),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsText: vi.fn(async () => '<cfdi:Comprobante/>'),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

const xmlMsg = { from: '5219993700779', type: 'document' as const, mediaId: 'doc1', waMessageId: 'wa-xml-1' };

/** Lo que devuelve `parseCfdiXml` — sin `total`, que es el caso del hallazgo. */
function cfdi(total: number | undefined) {
  return {
    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fecha: '2026-08-01T10:00:00',
    total,
    subTotal: undefined,
    rfcEmisor: 'AAA010101AAA',
    rfcReceptor: 'BBB020202BB1',
    iepsTraslado: 0, ivaTraslado: 0,
    conceptos: [], lineas: [],
    claveProdServ: '15101514', claveUnidad: 'LTR', cantidad: 100,
    tipoComprobante: 'I', formaPago: '04',
    complementoHidrocarburos: true, esquemaAlterno: false,
  };
}

// El montaje es el mismo para los dos hallazgos de este archivo, así que vive
// arriba: un `beforeEach` dentro de un `describe` no alcanza al de al lado, y
// esa es justo la forma de que un mock se arrastre entre bloques.
beforeEach(() => {
  salientes.length = 0;
  addGasto.mockReset(); addGasto.mockResolvedValue(undefined);
  saveCfdiXmlRaw.mockReset(); saveCfdiXmlRaw.mockResolvedValue(undefined);
  parseCfdiXml.mockReset();
  intakeDelta.mockReset(); intakeDelta.mockResolvedValue(1);
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
});

describe('DAT-37 · un CFDI sin Total no entra como gasto de $0.00', () => {

  it('sin @Total: NO se da de alta el gasto', async () => {
    parseCfdiXml.mockReturnValue(cfdi(undefined));
    await processInbound(xmlMsg);
    expect(addGasto, 'un renglón de $0.00 con xml_verificado es una cifra inventada')
      .not.toHaveBeenCalled();
  });

  it('sin @Total: el XML crudo SÍ se conserva (CFF 30) y se le dice al operador', async () => {
    parseCfdiXml.mockReturnValue(cfdi(undefined));
    await processInbound(xmlMsg);

    expect(saveCfdiXmlRaw, 'la evidencia no se tira; lo que no se hace es inventar el importe')
      .toHaveBeenCalled();
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/sin el total/i);
    expect(salientes[0], 'y qué hacer: la foto del ticket, o el XML completo').toMatch(/foto del ticket/i);
  });

  it('con @Total en cero (mismo agujero por otra puerta): tampoco entra', async () => {
    parseCfdiXml.mockReturnValue(cfdi(0));
    await processInbound(xmlMsg);
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('CONTROL — con @Total, el gasto entra con ese monto y xml_verificado', async () => {
    parseCfdiXml.mockReturnValue(cfdi(1234.5));
    await processInbound(xmlMsg);

    expect(addGasto).toHaveBeenCalledTimes(1);
    const g = addGasto.mock.calls[0][2] as { monto: number; xmlVerificado?: boolean };
    expect(g.monto).toBe(1234.5);
    expect(g.xmlVerificado).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DAT-19 · el XML en dólares llega al gasto DICIENDO que es en dólares.
//
// Leer `@Moneda` en el parser no sirve de nada si el processor la tira al
// construir el gasto: el motor levanta `moneda_extranjera` desde `ocrExtra`, y
// sin este cableado el USD 450 volvería a comprobarse como $450.00 MXN.
// ═══════════════════════════════════════════════════════════════════════════
describe('DAT-19 · la moneda del XML viaja hasta el gasto', () => {
  beforeEach(() => {
    parseCfdiXml.mockReturnValue({ ...cfdi(450), moneda: 'USD', tipoCambio: 18.75 });
  });

  it('el gasto nace con moneda y tipo de cambio en ocrExtra', async () => {
    await processInbound(xmlMsg);
    const g = addGasto.mock.calls[0][2] as { ocrExtra?: Record<string, unknown> };
    expect(g.ocrExtra?.moneda).toBe('USD');
    expect(g.ocrExtra?.tipoCambio).toBe(18.75);
  });

  it('el importe NO se convierte: la conversión la hace una persona', async () => {
    await processInbound(xmlMsg);
    const g = addGasto.mock.calls[0][2] as { monto: number };
    expect(g.monto).toBe(450);
  });

  it('un XML en pesos no ensucia el gasto con llaves de más', async () => {
    parseCfdiXml.mockReturnValue({ ...cfdi(450), moneda: 'MXN' });
    await processInbound(xmlMsg);
    const g = addGasto.mock.calls[0][2] as { ocrExtra?: Record<string, unknown> };
    expect(g.ocrExtra?.moneda).toBe('MXN');
    expect(g.ocrExtra?.tipoCambio).toBeUndefined();
  });
});
