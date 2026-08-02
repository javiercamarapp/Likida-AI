import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · CRÍTICO de pruebas (superviviente de la ronda 6, 3ª ronda sin
// tocar, el más grave de los cinco) — `if (!avisoPuesto) { ...; return; }`
// (processor.ts:314) es el bloqueo "SIN AVISO NO HAY TRATAMIENTO": antes de
// esta línea, una foto de comprobante (datos personales: montos, fechas,
// nombre y RFC del operador) se mandaba a un modelo externo sin que el aviso
// de privacidad (LFPDPPP art. 16 fr. II) estuviera puesto.
//
// Mutado a `if (false && !avisoPuesto)`, 1299/1300 pruebas seguían pasando:
// ningún test ejercitaba el camino donde `ponerAvisoADisposicion` falla.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const getDatosResponsable = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  // Sala de espera de comprobantes sin viaje (mig. 0040). Sin estas cuatro,
  // `getHuerfanos` llega `undefined` y el processor truena en el `.length`.
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false), reclamarFotoPendiente: vi.fn(async () => null),
  // Tenant sin razón social/domicilio capturados: getDatosResponsable devuelve
  // null y ponerAvisoADisposicion (real, no mockeado) tiene que devolver false.
  getDatosResponsable: (...a: unknown[]) => getDatosResponsable(...a),
  // `false` = "ya se le puso a disposición antes": ponerAvisoADisposicion
  // corta en `return true` sin necesitar confirmarEnvioAviso ni sendText
  // real, igual que hace processor_lock.test.ts para el mismo mock.
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

/** Todo lo que salió hacia la Graph API. */
const salientes: { url: string; body: Record<string, unknown> }[] = [];
const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
  salientes.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: 'wa1' };

describe('processInbound — sin aviso de privacidad puesto, no hay tratamiento', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); getDatosResponsable.mockReset();
    logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    // El tenant nunca terminó su alta: sin razón social ni domicilio.
    getDatosResponsable.mockResolvedValue(null);
    runAgent.mockResolvedValue({ finalText: 'Listo', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('NO llama al agente (no se trata la foto sin aviso)', async () => {
    await processInbound(foto);
    expect(runAgent, 'sin aviso puesto, la foto no debe llegar al agente/modelo').not.toHaveBeenCalled();
  });

  it('avisa al operador que falta terminar la configuración, y registra el bloqueo', async () => {
    await processInbound(foto);
    expect(salientes).toHaveLength(1);
    expect(String((salientes[0].body.text as { body: string }).body)).toMatch(/aviso de privacidad/i);
    expect(logger.error).toHaveBeenCalledWith('privacidad.tratamiento_bloqueado', expect.objectContaining({ tenant: 't1' }));
  });

  it('control: CON aviso puesto, NO bloquea (para que lo de arriba no pase por otra razón)', async () => {
    // Control necesario: sin este contraste, "no bloquea" podría deberse a que
    // el mock nunca ejercita el bloqueo, no a que el aviso sí esté puesto.
    getDatosResponsable.mockResolvedValue({
      razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
    });
    await processInbound(foto);
    expect(logger.error).not.toHaveBeenCalledWith('privacidad.tratamiento_bloqueado', expect.anything());
    const huboBloqueo = salientes.some((s) =>
      /aviso de privacidad/i.test(String((s.body.text as { body?: string } | undefined)?.body ?? '')));
    expect(huboBloqueo, 'con aviso puesto no debería salir el mensaje de bloqueo').toBe(false);
  });
});
