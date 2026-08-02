import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, MEDIO agéntico — el brazo del XML hace read-modify-write
// (getGastos → find → updateGastoCfdiXml) sobre una fila COMPARTIDA, no un
// insert nuevo como la foto. Dos XML del mismo total en el mismo lote (Meta
// los entrega juntos, `route.ts:72` los corre con `Promise.all`) leían el
// mismo `gastos` ANTES de que ninguno escribiera, los dos emparejaban con el
// MISMO ticket sin `cfdi_uuid`, y el segundo `updateGastoCfdiXml` pisaba al
// primero: su UUID, RFC emisor, IVA e IEPS desaparecían sin aviso.
//
// El arreglo envuelve el emparejamiento en el MISMO mutex de viaje que ya
// protege el "listo" contra el doble cierre (`acquireViajeLock`). Este
// archivo prueba el USO del mutex en el brazo del XML: que se toma antes de
// leer, que se libera después (incluso si la escritura truena), y que con el
// mutex ocupado NO se procede sin exclusividad — que es exactamente la
// carrera que esto existe para cerrar.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const acquireViajeLock = vi.fn();
const releaseViajeLock = vi.fn();
const updateGastoCfdiXml = vi.fn();
const getGastos = vi.fn();
const addGasto = vi.fn();
const saveCfdiXmlRaw = vi.fn();
const downloadMediaAsText = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** Orden real de las llamadas, para probar que el mutex ENVUELVE la lectura y la escritura. */
const orden: string[] = [];

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: (...a: unknown[]) => { orden.push('lock'); return acquireViajeLock(...a); },
  releaseViajeLock: (...a: unknown[]) => { orden.push('unlock'); return releaseViajeLock(...a); },
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  // Sala de espera de comprobantes sin viaje (mig. 0040). Sin estas cuatro,
  // `getHuerfanos` llega `undefined` y el processor truena en el `.length`.
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => { orden.push('addGasto'); return addGasto(...a); },
  getGastos: (...a: unknown[]) => { orden.push('getGastos'); return getGastos(...a); },
  updateGastoCfdiXml: (...a: unknown[]) => { orden.push('updateGastoCfdiXml'); return updateGastoCfdiXml(...a); },
  saveCfdiXmlRaw: (...a: unknown[]) => { orden.push('saveCfdiXmlRaw'); return saveCfdiXmlRaw(...a); },
  gastoExistePorHash: vi.fn(async () => false),
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

describe('processInbound — el brazo del XML respeta el mutex del viaje', () => {
  beforeEach(() => {
    salientes.length = 0;
    orden.length = 0;
    runAgent.mockReset(); acquireViajeLock.mockReset(); releaseViajeLock.mockReset();
    updateGastoCfdiXml.mockReset(); getGastos.mockReset(); addGasto.mockReset();
    saveCfdiXmlRaw.mockReset(); downloadMediaAsText.mockReset();
    logger.warn.mockReset(); logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    downloadMediaAsText.mockResolvedValue(XML_VALIDO);
    getGastos.mockResolvedValue([{ id: 'g1', cfdiUuid: null, monto: 1000, fecha: '2026-08-01', concepto: 'diesel' }]);
    updateGastoCfdiXml.mockResolvedValue(undefined);
    saveCfdiXmlRaw.mockResolvedValue(undefined);
  });

  it('toma el mutex ANTES de leer los gastos y lo libera DESPUÉS de escribir', async () => {
    acquireViajeLock.mockResolvedValue(true);

    await processInbound(xmlDoc);

    expect(acquireViajeLock).toHaveBeenCalledWith('v1', expect.anything());
    expect(orden).toEqual(['lock', 'getGastos', 'updateGastoCfdiXml', 'saveCfdiXmlRaw', 'unlock']);
  });

  it('con el mutex OCUPADO, NO lee ni escribe el gasto — evita la carrera en vez de correrla', async () => {
    acquireViajeLock.mockResolvedValue(false);

    await processInbound(xmlDoc);

    expect(getGastos, 'sin exclusividad, leer ya es parte de la carrera').not.toHaveBeenCalled();
    expect(updateGastoCfdiXml).not.toHaveBeenCalled();
    expect(addGasto).not.toHaveBeenCalled();
    expect(releaseViajeLock, 'nunca se tomó: no hay nada que soltar').not.toHaveBeenCalled();
  });

  it('con el mutex OCUPADO, avisa que hay otro XML en proceso (no se calla)', async () => {
    acquireViajeLock.mockResolvedValue(false);

    await processInbound(xmlDoc);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/otro xml|un momento|espera|proces/i);
  });

  it('el mutex se libera aunque la escritura truene con un error normal (no se traba el viaje)', async () => {
    acquireViajeLock.mockResolvedValue(true);
    updateGastoCfdiXml.mockRejectedValue(new Error('fallo de red cualquiera'));

    await processInbound(xmlDoc);

    expect(releaseViajeLock, 'un lock que no se suelta bloquea el próximo XML del mismo viaje').toHaveBeenCalledWith('v1');
  });
});
