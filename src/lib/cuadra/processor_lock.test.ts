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

// ───────────────────────────────────────────────────────────────────────────
// AUDITORÍA 5 · ALTO — este archivo mockeaba `@/lib/cuadra/tools` y
// `@/lib/meta/client` enteros. Ahora los dos corren de verdad y el único borde
// mockeado es `fetch` hacia la Graph API: "no le escribe al operador" pasa de
// ser "no se llamó un espía" a "no salió un solo byte hacia Meta", que es la
// afirmación que de verdad importa cuando el otro turno ya le está escribiendo.
// ───────────────────────────────────────────────────────────────────────────

const runAgent = vi.fn();
const acquireViajeLock = vi.fn();
const getOpenViaje = vi.fn();
const claimMessage = vi.fn<(id: string) => Promise<'nuevo' | 'duplicado' | 'indeterminado'>>(async () => 'nuevo');
const releaseMessageClaim = vi.fn();

/** Todo lo que salió hacia la Graph API. */
const salientes: { url: string; body: Record<string, unknown> }[] = [];
const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
  salientes.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: (...a: unknown[]) => getOpenViaje(...a),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: (...a: unknown[]) => claimMessage(...(a as [string])),
  acquireViajeLock: (...a: unknown[]) => acquireViajeLock(...a),
  releaseViajeLock: vi.fn(), releaseMessageClaim: (...a: unknown[]) => releaseMessageClaim(...a),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  // Sala de espera de comprobantes sin viaje (mig. 0040). Sin estas cuatro,
  // `getHuerfanos` llega `undefined` y el processor truena en el `.length`.
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false), reclamarFotoPendiente: vi.fn(async () => null),
  // El aviso ya se le puso a disposición antes (`reclamarEnvioAviso` → false):
  // no se manda otra vez y no estorba. Sin datos de responsable el processor
  // bloquearía el tratamiento y el mutex ni se consultaría.
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida',
    urlAvisoIntegral: 'https://flota.mx/privacidad',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  // `tools.ts` se importa de verdad: estos son sus accesos a datos.
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { processInbound } = await import('./processor');

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };

describe('processInbound — mutex del viaje', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); acquireViajeLock.mockReset(); getOpenViaje.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    getOpenViaje.mockResolvedValue('v1');
    runAgent.mockResolvedValue({ finalText: 'Listo', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('con el lock TOMADO, corre el agente', () => {
    // Control: sin esto, un test que solo mira el caso de abandono pasaría
    // igual si el processor nunca corriera el agente.
    acquireViajeLock.mockResolvedValue(true);
    return processInbound(listo).then(() => {
      expect(runAgent).toHaveBeenCalledTimes(1);
      // Y el mensaje SÍ sale, por el camino real: sin este contraste, la prueba
      // de abajo pasaría igual si nunca saliera nada.
      expect(salientes).toHaveLength(1);
      expect(salientes[0].body.to).toBe('529993700779');
    });
  });

  it('con el lock OCUPADO, NO corre el agente', async () => {
    acquireViajeLock.mockResolvedValue(false);
    await processInbound(listo);
    expect(runAgent, 'el segundo "listo" no puede correr el agente sin mutex').not.toHaveBeenCalled();
  });

  // AUDITORÍA 7 · ALTO — antes, con el lock ocupado, no salía NADA: el operador
  // veía sus dos palomitas azules y ninguna respuesta a ESE mensaje, "listo"
  // nunca corría el agente, nunca entraba a `wa_conversacion`, y seguía
  // reclamado en `wa_mensaje_procesado` para siempre (el `return` no pasaba por
  // `releaseMessageClaim`). El fix (acotado; la cola de verdad es FASE 3):
  // cuando se pierde el lock, se AVISA que se está procesando el otro mensaje y
  // se libera el claim para no dejarlo atascado.
  it('con el lock OCUPADO, avisa que ya está ocupado (no se calla) y libera el claim', async () => {
    acquireViajeLock.mockResolvedValue(false);
    await processInbound(listo);
    expect(salientes, 'antes se callaba del todo; ahora avisa').toHaveLength(1);
    expect(String((salientes[0].body.text as { body: string }).body)).toMatch(/un momento|espera|proces/i);
    expect(releaseMessageClaim).toHaveBeenCalledWith('wa1');
  });

  it('con el lock OCUPADO, sigue sin correr el agente (no hay doble cuadre)', async () => {
    acquireViajeLock.mockResolvedValue(false);
    await processInbound(listo);
    expect(runAgent, 'el mensaje que pierde el mutex no corre el agente igual').not.toHaveBeenCalled();
  });
});
