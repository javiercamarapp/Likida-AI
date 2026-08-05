// ═══════════════════════════════════════════════════════════════════════════
// UN BLIP DE RED SE LE PRESENTABA AL CHOFER COMO UN ERROR DE SU PATRÓN.
//
// `sendText` SÍ lanza: lleva `AbortSignal.timeout(10_000)` y no tiene try/catch,
// así que un fallo de red o un timeout salen como excepción. Esa excepción caía
// en el catch de `ponerAvisoADisposicion`, que devolvía `false` — el MISMO
// `false` que devuelve cuando la flota de verdad no ha capturado su razón social
// y su domicilio. Y el llamador traducía ese `false` a:
//
//   «tu empresa aún no ha terminado de configurar su aviso de privacidad»
//
// …con la foto descartada y el mensaje ya marcado como procesado. Tres cosas
// mal de un tirón: se le echa la culpa a su jefe de un problema nuestro, se
// pierde el comprobante, y el claim queda tomado para que ni reintentando entre.
//
// Aquí se ejercita `processInbound` de verdad y se mira lo único que le llega
// al chofer: el texto.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const salientes: string[] = [];
const releaseMessageClaim = vi.fn();
const getDatosResponsable = vi.fn();
const reclamarEnvioAviso = vi.fn();
const sendText = vi.fn(async (_to: string, t: string) => { salientes.push(t); return 'wamid.1'; });

vi.mock('@/lib/cuadra/tools', () => ({}));
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...(a as [string, string])),
  sendButtons: vi.fn(), sendDocument: vi.fn(),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  downloadMediaAsText: vi.fn(),
}));
vi.mock('@/lib/cuadra/intake/ocr', () => ({ extraerComprobante: vi.fn() }));
vi.mock('@/lib/cuadra/intake/almacen', () => ({ subirComprobante: vi.fn(async () => undefined) }));
vi.mock('@/lib/cuadra/repo', () => ({
  getDatosResponsable: (...a: unknown[]) => getDatosResponsable(...a),
  reclamarEnvioAviso: (...a: unknown[]) => reclamarEnvioAviso(...a),
  confirmarEnvioAviso: vi.fn(), liberarEnvioAviso: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  ubicarGastoPorHash: vi.fn(async () => null), getHuerfanos: vi.fn(async () => []),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false), gastoPorHash: vi.fn(async () => null),
  corregirFechaGasto: vi.fn(), enriquecerGastoConCodigo: vi.fn(),
  guardarCodigoPendiente: vi.fn(), getCodigosPendientes: vi.fn(async () => []),
  reclamarCodigoPendiente: vi.fn(), getViaje: vi.fn(async () => null),
}));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1', nombre: 'Chuy', telefono: '52999' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombreFlota: 'Flota', agentName: 'Likida' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo'),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: (...a: unknown[]) => releaseMessageClaim(...a),
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { processInbound } = await import('./processor');

const RESPONSABLE = {
  razonSocial: 'Transportes del Norte SA de CV',
  domicilio: 'Av. Vallarta 1234, Guadalajara',
  urlAvisoIntegral: 'https://ejemplo.mx/aviso',
};
const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa1' };

beforeEach(() => {
  salientes.length = 0;
  sendText.mockClear(); releaseMessageClaim.mockClear();
  getDatosResponsable.mockReset(); reclamarEnvioAviso.mockReset();
  getDatosResponsable.mockResolvedValue(RESPONSABLE);
  reclamarEnvioAviso.mockResolvedValue(true);   // toca mandarle el aviso ahora
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
});

describe('el aviso de privacidad distingue el fallo NUESTRO del de la flota', () => {
  it('un timeout de red NO se le presenta como un problema de su empresa', async () => {
    // Exactamente lo que hace `sendText` cuando vence su AbortSignal.
    sendText.mockImplementationOnce(async () => { throw new Error('The operation was aborted due to timeout'); });

    await processInbound(foto);

    const dicho = salientes.join('\n');
    expect(dicho, 'se le echó la culpa a su patrón de un fallo nuestro')
      .not.toMatch(/aviso de privacidad|Av[ií]sale a tu flota/i);
    expect(dicho).toMatch(/no es cosa tuya ni de tu empresa/i);
  });

  it('y el claim se LIBERA: un mensaje que no se procesó no puede quedar contado', async () => {
    sendText.mockImplementationOnce(async () => { throw new Error('fetch failed'); });
    await processInbound(foto);
    expect(releaseMessageClaim).toHaveBeenCalledWith('wa1');
  });

  it('la flota SIN datos capturados sí recibe el mensaje administrativo', async () => {
    getDatosResponsable.mockResolvedValue(null);   // nunca terminó su alta
    await processInbound(foto);

    expect(salientes.join('\n')).toMatch(/aviso de privacidad/i);
    expect(salientes.join('\n')).toMatch(/Av[ií]sale a tu flota/i);
  });

  it('y ahí NO se libera el claim: reintentar no va a dar de alta a la flota', async () => {
    getDatosResponsable.mockResolvedValue(null);
    await processInbound(foto);
    expect(releaseMessageClaim).not.toHaveBeenCalled();
  });

  it('Meta rechazando el envío tampoco es culpa de la empresa', async () => {
    // `sendText` devuelve null cuando Meta contesta !ok (p. ej. 131030).
    sendText.mockImplementationOnce(async () => null as unknown as string);
    await processInbound(foto);
    expect(salientes.join('\n')).not.toMatch(/aviso de privacidad/i);
  });
});
