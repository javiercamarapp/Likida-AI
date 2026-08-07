import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO (agéntico) — "El XML del CFDI no toma la barrera ni el
// mutex".
//
// Las fotos hacen +1 al contador de intake al entrar y -1 al salir; el
// "listo" espera a que ese contador llegue a 0 antes de cuadrar. El XML NO
// hacía nada de eso — y su ruta es lenta: dos `fetch` a la Graph API con
// 15 s de tope cada uno (hasta 30 s que la barrera no podía ver).
//
// Escenario del hallazgo: operador manda la foto del diésel, reenvía el XML
// por correo (12 s de descarga) y 4 s después escribe "listo". Sin este
// arreglo, `esperarIntake` ve el contador en 0 (el XML nunca lo tocó), cierra
// sobre datos parciales, y el estímulo/IVA acreditable de esa carga se pierde
// para siempre.
//
// Fix: el documento participa en el MISMO contador que la foto, con el mismo
// contrato fail-closed que ya prueba `processor_intake_delta_falla.test.ts`
// para imágenes.
// ═══════════════════════════════════════════════════════════════════════════

const intakeDelta = vi.fn();
const releaseMessageClaim = vi.fn();
const downloadMediaAsText = vi.fn();
const getGastos = vi.fn();
const updateGastoCfdiXml = vi.fn();

vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsText: (...a: unknown[]) => downloadMediaAsText(...a),
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
  releaseMessageClaim: (...a: unknown[]) => releaseMessageClaim(...a),
  intakeDelta: (...a: unknown[]) => intakeDelta(...(a as [string, number])),
  esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  // Sala de espera de comprobantes sin viaje (mig. 0040). Sin estas cuatro,
  // `getHuerfanos` llega `undefined` y el processor truena en el `.length`.
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: (...a: unknown[]) => getGastos(...a),
  updateGastoCfdiXml: (...a: unknown[]) => updateGastoCfdiXml(...a),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
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

const xmlDoc = { from: '5219993700779', type: 'document' as const, mediaId: 'media1', waMessageId: 'wa1' };
const XML_VALIDO = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Total="1000.00" SubTotal="862.07" FormaPago="03"><cfdi:Emisor Rfc="PEM850101AAA"/><cfdi:Receptor Rfc="TRA850101AB1"/><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Impuesto="002" Importe="137.93"/></cfdi:Traslados></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d"/></cfdi:Complemento></cfdi:Comprobante>`;

beforeEach(() => {
  salientes.length = 0;
  intakeDelta.mockReset(); releaseMessageClaim.mockClear();
  downloadMediaAsText.mockReset(); getGastos.mockReset(); updateGastoCfdiXml.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  getGastos.mockResolvedValue([{ id: 'g1', cfdiUuid: null, monto: 1000, fecha: '2026-08-01', concepto: 'diesel' }]);
  updateGastoCfdiXml.mockResolvedValue(undefined);
});

describe('el documento (XML) sostiene la barrera del "listo", igual que la foto', () => {
  it('hace +1 al entrar y -1 al salir cuando el XML se procesa con éxito', async () => {
    intakeDelta.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    downloadMediaAsText.mockResolvedValue(XML_VALIDO);

    await processInbound(xmlDoc);

    expect(intakeDelta).toHaveBeenNthCalledWith(1, 'v1', 1);
    expect(intakeDelta).toHaveBeenNthCalledWith(2, 'v1', -1);
  });

  it('el -1 corre aunque el documento no sea un XML válido (no se cuelga la barrera)', async () => {
    intakeDelta.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    downloadMediaAsText.mockResolvedValue('esto no es un CFDI');

    await processInbound(xmlDoc);

    const menosUno = intakeDelta.mock.calls.filter((c) => c[1] === -1);
    expect(menosUno).toHaveLength(1);
  });

  it('el -1 corre aunque el XML llegue tarde (CU001)', async () => {
    intakeDelta.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    downloadMediaAsText.mockResolvedValue(XML_VALIDO);
    const err = new Error('el viaje ya tiene liquidación emitida') as Error & { code?: string };
    err.code = 'CU001';
    updateGastoCfdiXml.mockRejectedValue(err);

    await processInbound(xmlDoc);

    const menosUno = intakeDelta.mock.calls.filter((c) => c[1] === -1);
    expect(menosUno).toHaveLength(1);
  });

  it('fail-closed: si el +1 falla, NO descarga el XML ni ejecuta el -1 gemelo, y libera el claim', async () => {
    intakeDelta.mockResolvedValueOnce(null);

    await processInbound(xmlDoc);

    expect(downloadMediaAsText).not.toHaveBeenCalled();
    const menosUno = intakeDelta.mock.calls.filter((c) => c[1] === -1);
    expect(menosUno).toHaveLength(0);
    expect(releaseMessageClaim).toHaveBeenCalledWith('wa1');
    expect(salientes.join(' ')).toMatch(/no pude registrar|reenv/i);
  });
});
