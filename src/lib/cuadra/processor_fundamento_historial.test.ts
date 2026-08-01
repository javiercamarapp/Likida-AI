import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO REINCIDENTE de AG-2 — "Sin ninguna tool en el turno, toda
// cita normativa se sigue borrando a media frase".
//
// `e50510c` le dio permiso de citar a `consultar_politica`, pero el permiso
// viajaba SOLO con una tool. El turno más común frente a un contralor —el
// operador pregunta "¿en qué se basan?" y el modelo contesta de memoria, SIN
// llamar ninguna tool porque no hay nada nuevo que cuadrar— seguía saliendo
// con `permitidas = []`, y la guardia le arrancaba la cita a media frase:
//
//   ENTRA: "...tope conforme al artículo 27, fracción III de la LISR."
//   SALE : "...tope conforme al."
//
// Y el caso señalado por la auditoría es alcanzable justo donde más duele: el
// resumen determinístico de `engine.ts` YA metió esa cita en un turno
// anterior — se guardó en `wa_conversacion.estado.turns` DESPUÉS de pasar por
// esta misma guardia (o directo del motor, que es su propia fuente
// autoritativa) — y el modelo la repite en el turno siguiente.
//
// Esta prueba corre `processInbound` de verdad, con CERO tool calls este
// turno, y un turno `assistant` previo en el historial que YA trae la cita.
// Repetir lo que el sistema mismo ya entregó no es alucinar: es memoria.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));

let turnsPrevios: { role: 'user' | 'assistant'; content: string }[] = [];

vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ id: 'o1', tenantId: 't1', nombre: 'Operador' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: turnsPrevios })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
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

const pregunta = { from: '5219993700779', type: 'text' as const, text: '¿en qué se basan?', waMessageId: 'wa1' };

describe('guardiaFundamento sin ninguna tool este turno', () => {
  beforeEach(() => {
    salientes.length = 0;
    turnsPrevios = [];
    runAgent.mockReset();
    logger.warn.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('repite intacta una cita que el sistema YA entregó en un turno anterior de este mismo viaje', async () => {
    turnsPrevios = [
      { role: 'user', content: 'diesel 500 pesos efectivo' },
      { role: 'assistant', content: 'Ojo: el pago en efectivo tiene tope conforme al artículo 27, fracción III de la LISR.' },
    ];
    runAgent.mockResolvedValue({
      finalText: 'Sí cuenta, pero ojo: el pago de diésel en efectivo tiene tope conforme al artículo 27, fracción III de la LISR.',
      toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
    });

    await processInbound(pregunta);

    expect(salientes).toHaveLength(1);
    expect(salientes[0], 'la guardia mutiló una cita que el propio sistema ya había entregado antes').toMatch(
      /artículo 27, fracción III de la LISR/i,
    );
  });

  it('sigue borrando una cita que NUNCA se estableció en este viaje (no hay memoria que valga)', async () => {
    turnsPrevios = [];
    runAgent.mockResolvedValue({
      finalText: 'Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.',
      toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
    });

    await processInbound(pregunta);

    expect(salientes).toHaveLength(1);
    expect(salientes[0], 'sin historial ni tool, la cita no tiene de dónde salir legítimamente').not.toMatch(/20-A/);
    expect(logger.warn).toHaveBeenCalledWith('agent.fundamento_forzado', expect.anything());
  });
});
