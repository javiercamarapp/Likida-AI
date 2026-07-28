import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL MUTEX PERDIDO TIENE QUE ABANDONAR EL TURNO.
//
// `acquireViajeLock` devolvía `false` y el processor solo dejaba un warn: seguía
// de largo SIN mutex, que es justo lo que el mutex viene a impedir.
//
// El escenario: dos "listo" seguidos del mismo operador. El primero tarda ≥15s
// en el agente; el segundo agota su ventana de 12s, no consigue el lease, ve el
// viaje todavía abierto y corre el agente TAMBIÉN. La BD impide la doble fila
// (upsert de `guardar_liquidacion_tx`), pero como el upsert no lanza, las dos
// ejecuciones reportan éxito → el operador recibe el cierre y el PDF DOS VECES,
// y se paga el LLM dos veces.
//
// Existía un test del lock aislado, pero ninguno de su INTEGRACIÓN con el
// processor, que es donde vivía el bug. Este es ese test.
//
// Abandonar es seguro porque `false` significa una sola cosa: otro turno tiene el
// lease vigente y ESE va a responder. Los errores de la RPC no llegan aquí —
// `acquireViajeLock` es fail-open y devuelve `true` ante RPC ausente o fallo
// persistente (ver conv.ts y conv_lock.test.ts).
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const acquireViajeLock = vi.fn();
const sendText = vi.fn();
const getOpenViaje = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/tools', () => ({}));
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  sendDocument: vi.fn(), downloadMediaAsDataUrl: vi.fn(), downloadMediaAsText: vi.fn(),
}));
vi.mock('@/lib/cuadra/conv', () => ({
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: (...a: unknown[]) => getOpenViaje(...a),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => true),
  acquireViajeLock: (...a: unknown[]) => acquireViajeLock(...a),
  releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  // Sin datos de responsable: el aviso de privacidad no se manda y no estorba.
  getDatosResponsable: vi.fn(async () => null), reclamarEnvioAviso: vi.fn(async () => false),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { processInbound } = await import('./processor');

const listo = { from: '+521111111101', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };

describe('processInbound — mutex del viaje', () => {
  beforeEach(() => {
    runAgent.mockReset(); acquireViajeLock.mockReset(); sendText.mockReset(); getOpenViaje.mockReset();
    getOpenViaje.mockResolvedValue('v1');
    runAgent.mockResolvedValue({ finalText: 'Listo', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('con el lock TOMADO, corre el agente', () => {
    // Control: sin esto, un test que solo mira el caso de abandono pasaría
    // igual si el processor nunca corriera el agente.
    acquireViajeLock.mockResolvedValue(true);
    return processInbound(listo).then(() => {
      expect(runAgent).toHaveBeenCalledTimes(1);
    });
  });

  it('con el lock OCUPADO, NO corre el agente', async () => {
    acquireViajeLock.mockResolvedValue(false);
    await processInbound(listo);
    expect(runAgent, 'el segundo "listo" no puede correr el agente sin mutex').not.toHaveBeenCalled();
  });

  it('con el lock OCUPADO, tampoco le escribe al operador', async () => {
    // El otro turno ya le está escribiendo: un segundo mensaje que nadie pidió
    // se ve como un bug delante del comprador.
    acquireViajeLock.mockResolvedValue(false);
    await processInbound(listo);
    expect(sendText).not.toHaveBeenCalled();
  });
});
