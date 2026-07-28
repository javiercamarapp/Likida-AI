import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el cierre sin PDF era invisible para todos.
//
// `guardar_liquidacion` devuelve `pdf_generado: Boolean(pdfPath)` y pone
// `pdfPath = undefined` si `generarLiquidacionPDF` lanza o si el upload a storage
// falla. La liquidación se guarda IGUAL. Pero el processor solo miraba `closed` y
// nunca leía `pdf_generado`: pedía una URL firmada de un objeto inexistente,
// `createSignedUrl` devolvía `{data:null,error}` —y el error se descartaba en el
// destructuring—, `data?.signedUrl` era falsy, no había `else`, y el `catch` no se
// disparaba.
//
// Resultado: la liquidación queda cerrada, el operador espera el documento que
// `prompts.ts` le prometió ("Avísale que le llega su liquidación en PDF"), no
// llega, y en los logs no hay `pdf.send`, ni warn, ni nada. En el demo es el paso
// 3 del guion fallando en silencio.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const sendText = vi.fn();
const sendDocument = vi.fn();
const createSignedUrl = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/tools', () => ({}));
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  sendDocument: (...a: unknown[]) => sendDocument(...a),
  downloadMediaAsDataUrl: vi.fn(), downloadMediaAsText: vi.fn(),
}));
vi.mock('@/lib/cuadra/conv', () => ({
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => true),
  acquireViajeLock: vi.fn(async () => true),
  releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => null), reclamarEnvioAviso: vi.fn(async () => false),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a) }) } }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');

const listo = { from: '+521111111101', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };

const cierre = (pdf_generado: boolean) => ({
  finalText: 'Listo, cerré tu viaje',
  toolCalls: [{ toolName: 'guardar_liquidacion', args: {}, result: { liquidacion_id: 'L1', pdf_generado }, durationMs: 5 }],
  model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
});

describe('cierre sin PDF: ni se manda un documento que no existe, ni se calla', () => {
  beforeEach(() => {
    runAgent.mockReset(); sendText.mockReset(); sendDocument.mockReset();
    createSignedUrl.mockReset(); logger.error.mockReset(); logger.warn.mockReset();
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/liq.pdf' }, error: null });
  });

  it('con pdf_generado=true manda el documento (control: sin esto lo de abajo no prueba nada)', async () => {
    runAgent.mockResolvedValue(cierre(true));
    await processInbound(listo);
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('con pdf_generado=false NO pide una URL de un objeto que no existe', async () => {
    runAgent.mockResolvedValue(cierre(false));
    await processInbound(listo);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it('con pdf_generado=false deja rastro en el log — antes no había ni una línea', async () => {
    runAgent.mockResolvedValue(cierre(false));
    await processInbound(listo);
    expect(logger.error).toHaveBeenCalledWith('pdf.no_entregado', expect.objectContaining({ viaje: 'v1', pdfGenerado: false }));
  });

  it('con pdf_generado=false se lo dice al operador, en vez de dejarlo esperando', async () => {
    runAgent.mockResolvedValue(cierre(false));
    await processInbound(listo);
    const dicho = sendText.mock.calls.map((c) => String(c[1])).join('\n');
    expect(dicho).toMatch(/no pude generarte el PDF|panel/i);
  });

  it('si storage falla al firmar, tampoco se calla', async () => {
    runAgent.mockResolvedValue(cierre(true));
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    await processInbound(listo);
    expect(sendDocument).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('pdf.no_entregado', expect.objectContaining({ err: 'Object not found' }));
  });
});
