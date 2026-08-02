import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO (backend) — el catch de `ConsultaFallida`/`OperadorAmbiguo`
// en `processInbound` nunca se disparaba DENTRO de una llamada real: los
// cuatro suites que importan `processInbound` mockean `resolveOperador` para
// que siempre tenga éxito. La selección de mensaje (`ambiguo ? ... :
// noSePudoConsultar ? ... : ...`) podía invertirse o perder una rama y los
// 1300+ tests de la línea base seguían en verde.
//
// Este archivo lanza las excepciones REALES (import de `./conv`, no un doble)
// desde `resolveOperador` y verifica el mensaje exacto que recibe el
// operador, más que el claim se libera.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const resolveOperador = vi.fn();
const releaseMessageClaim = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: (...a: unknown[]) => releaseMessageClaim(...a),
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
const { ConsultaFallida, OperadorAmbiguo } = await import('./conv');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };

describe('processInbound — ConsultaFallida y OperadorAmbiguo, disparadas de verdad', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); resolveOperador.mockReset(); releaseMessageClaim.mockReset();
    logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('ConsultaFallida: dice que la conexión falló, NO que no está registrado', async () => {
    resolveOperador.mockRejectedValue(new ConsultaFallida('resolveOperador: 57014 statement timeout'));
    await processInbound(listo);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/no pude consultar tus datos/i);
    expect(salientes[0], 'no puede afirmar que no está registrado: no se sabe').not.toMatch(/no te tengo registrado/i);
    expect(releaseMessageClaim).toHaveBeenCalledWith('wa1');
    expect(logger.error).toHaveBeenCalledWith('processInbound.consulta_fallida', expect.anything());
  });

  it('OperadorAmbiguo: dice que su número está duplicado, NO que falló la conexión', async () => {
    resolveOperador.mockRejectedValue(new OperadorAmbiguo('5219993700779'));
    await processInbound(listo);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/aparece dado de alta más de una vez/i);
    expect(salientes[0], 'no puede pedirle que reintente: reintentar no arregla un duplicado').not.toMatch(/vuelve a intentarlo/i);
    expect(releaseMessageClaim).toHaveBeenCalledWith('wa1');
    expect(logger.error).toHaveBeenCalledWith('processInbound.operador_ambiguo', expect.anything());
  });

  it('un error genérico sigue cayendo al mensaje de siempre, sin confundirse con los dos de arriba', async () => {
    resolveOperador.mockRejectedValue(new Error('boom'));
    await processInbound(listo);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/se me trabó/i);
    expect(logger.error).toHaveBeenCalledWith('processInbound.fail', expect.anything());
  });
});
