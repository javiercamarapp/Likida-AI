import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 7 · ALTO — un `+1` fallido de la barrera no detiene la foto, pero
// el `-1` corre igual: la barrera abre sobre datos parciales y sin avisar.
//
// `intakeDelta(viajeId, 1)` puede devolver `null` (fallo transitorio de la RPC).
// El código descartaba ese resultado y seguía de largo a descargar/OCR/registrar
// el gasto igual — sosteniendo la barrera con un incremento que NUNCA ocurrió.
// El `finally` decrementa PASE LO QUE PASE, así que esa foto nunca cuenta para
// "listo": si su OCR no termina antes de que el operador escriba "listo", el
// cuadre se cierra SIN ese comprobante, sin avisar, y el operador paga de su
// bolsa un gasto que sí hizo.
//
// El fix: si el +1 falla, la foto NO se descarta, pero SÍ se avisa al operador
// que no se pudo garantizar el orden y se le pide reenviar cuando le confirmen
// que cerró — y sobre todo, NO se ejecuta el -1 gemelo (no hay incremento que
// deshacer). Se prueba forzando `intakeDelta(v,1)` a devolver `null` y
// verificando que `intakeDelta(v,-1)` NUNCA se llama para esa foto.
// ═══════════════════════════════════════════════════════════════════════════

const intakeDelta = vi.fn();
const releaseMessageClaim = vi.fn();
const extraerComprobante = vi.fn();
const say = vi.fn();

vi.mock('@/lib/cuadra/tools', () => ({}));
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => say(...a),
  sendDocument: vi.fn(),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  downloadMediaAsText: vi.fn(),
}));
vi.mock('@/lib/cuadra/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida',
    urlAvisoIntegral: 'https://flota.mx/privacidad',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
}));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo'),
  acquireViajeLock: vi.fn(async () => true),
  releaseViajeLock: vi.fn(), releaseMessageClaim: (...a: unknown[]) => releaseMessageClaim(...a),
  intakeDelta: (...a: unknown[]) => intakeDelta(...(a as [string, number])),
  esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { processInbound } = await import('./processor');

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa1' };

beforeEach(() => {
  intakeDelta.mockReset(); releaseMessageClaim.mockClear();
  extraerComprobante.mockReset();
  say.mockReset();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
});

describe('intakeDelta(+1) fallido: no se sostiene la barrera con un incremento que no ocurrió', () => {
  it('si el +1 falla, NO se ejecuta el -1 gemelo (nada que deshacer)', async () => {
    intakeDelta.mockResolvedValueOnce(null); // el +1 de esta foto falla
    extraerComprobante.mockResolvedValue({
      gasto: { id: 'g1', concepto: 'diesel', monto: 500 },
      legible: true, motivo: 'ticket',
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
    await processInbound(foto);
    // El +1 se intentó una vez; el -1 (segundo argumento -1) NUNCA debe correr
    // para esta foto, porque no hay incremento que compensar.
    const llamadasMenosUno = intakeDelta.mock.calls.filter((c) => c[1] === -1);
    expect(llamadasMenosUno).toHaveLength(0);
  });

  it('si el +1 falla, se avisa al operador en vez de procesar en silencio', async () => {
    intakeDelta.mockResolvedValueOnce(null);
    extraerComprobante.mockResolvedValue({
      gasto: { id: 'g1', concepto: 'diesel', monto: 500 },
      legible: true, motivo: 'ticket',
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
    await processInbound(foto);
    expect(say).toHaveBeenCalled();
    const dicho = say.mock.calls.map((c) => c[1]).join(' ');
    expect(dicho).toMatch(/no se pudo garantizar el orden|escribe \*listo\* otra vez|reenv.a/i);
  });

  it('control: si el +1 SÍ funciona, el -1 gemelo SÍ corre (comportamiento normal intacto)', async () => {
    intakeDelta.mockResolvedValueOnce(1); // el +1 funciona
    intakeDelta.mockResolvedValueOnce(0); // el -1 del finally
    extraerComprobante.mockResolvedValue({
      gasto: { id: 'g1', concepto: 'diesel', monto: 500 },
      legible: true, motivo: 'ticket',
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
    await processInbound(foto);
    const llamadasMenosUno = intakeDelta.mock.calls.filter((c) => c[1] === -1);
    expect(llamadasMenosUno).toHaveLength(1);
  });
});

// ── REVISIÓN DEL 31-JUL: EL CLAIM SE QUEDABA TOMADO ────────────────────────
//
// El `return` de arriba avisa al operador —"reenvíala en un momento"— pero NO
// liberaba el claim de `wa_mensaje_procesado`. Es EXACTAMENTE el patrón que otro
// commit del mismo día arregló treinta líneas más abajo, con su comentario:
// "seguía reclamado PARA SIEMPRE (este `return` no pasaba por
// `releaseMessageClaim`)... el modo de falla 'se trabó' sin que nadie diga que
// se trabó".
//
// Dos returns tempranos, mismo archivo, mismo día: uno aprendió la lección y el
// otro la reintrodujo.
//
// El daño es acotado —el reenvío MANUAL trae otro `waMessageId`, así que el
// operador sí puede recuperarse— pero deja el mensaje original marcado como
// procesado para siempre, y cualquier reintento del MISMO id se descarta en
// silencio. La idempotencia deja de tener vuelta atrás justo en el camino donde
// se le pide al operador que reintente.
describe('el claim no puede quedarse tomado cuando la foto no se procesó', () => {
  it('libera el claim para que ese mensaje no quede atascado', async () => {
    intakeDelta.mockResolvedValue(null);
    await processInbound({ from: '5219993700779', type: 'image', mediaId: 'M1', waMessageId: 'wa-atascado' });
    expect(releaseMessageClaim).toHaveBeenCalledWith('wa-atascado');
  });

  // NO hay prueba de control del camino feliz aquí, y es a propósito: se
  // intentó una y resultó que entraba al CATCH GENERAL —que también libera el
  // claim (processor.ts:885)— en vez de ejercitar el camino bueno. Una prueba
  // que pasa por la razón equivocada es peor que ninguna, así que se quitó en
  // lugar de ajustarle la aserción hasta que se pusiera verde.
});
