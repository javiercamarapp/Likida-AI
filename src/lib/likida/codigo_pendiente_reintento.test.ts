import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD 22-ago-2026 · DAT-37 — LA BANDEJA DE CÓDIGOS SE LLENABA DE
// COPIAS PORQUE EL AVISO PODÍA TUMBAR EL TURNO.
//
// El acercamiento al código de barras se guarda en `codigo_pendiente` (0016),
// que hasta la 0164 no tenía NINGUNA unicidad. Y justo después del guardado
// vivía un `await say(...)` DENTRO de un `catch` — el fallback del conteo.
// Encadenado:
//
//   1. `guardarCodigoPendiente` escribe la fila;
//   2. el conteo falla (base lenta) → cae al catch;
//   3. el `say` del catch lanza → no lo atrapa nadie;
//   4. el catch general de `procesarTurno` suelta el claim;
//   5. la bandeja durable reprocesa el MISMO mensaje → segunda fila.
//
// La segunda fila no se empareja nunca (`pegarCodigoEnEspera` consume una) y se
// queda ahí contando como «hay un código sin su ticket», que es justo la señal
// que la oficina usa para saber qué falta timbrar.
//
// Los dos arreglos van juntos y ninguno sustituye al otro: los índices de la
// 0164 impiden la fila repetida; esto impide el bucle que la provocaba.
// ═══════════════════════════════════════════════════════════════════════════

const extraerComprobante = vi.fn();
const getCodigosPendientes = vi.fn();
const guardarCodigoPendiente = vi.fn();
const registrarCostoWhatsApp = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/likida/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/likida/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH') }));
vi.mock('@/lib/likida/intake/almacen', () => ({
  subirComprobante: vi.fn(async () => 't1/v1/HASH.jpg'), ligaComprobante: vi.fn(),
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
  releaseMessageClaim: vi.fn(), completarMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), corregirFechaGasto: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false), gastoPorHash: vi.fn(async () => null),
  getGastos: vi.fn(async () => []),
  updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(),
  guardarCodigoPendiente: (...a: unknown[]) => guardarCodigoPendiente(...a),
  getCodigosPendientes: (...a: unknown[]) => getCodigosPendientes(...a),
  reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, fechaInicio: '2026-08-01' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/likida/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
    validacion: { fechaToleranciaDiasAntes: 30 },
  })),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: (...a: unknown[]) => registrarCostoWhatsApp(...a),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
  { status: 200, headers: { 'content-type': 'application/json' } }));

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: 'wa-cod-1' };

describe('DAT-37 · el aviso del acercamiento no puede tumbar el turno', () => {
  beforeEach(() => {
    extraerComprobante.mockReset(); getCodigosPendientes.mockReset();
    guardarCodigoPendiente.mockReset(); guardarCodigoPendiente.mockResolvedValue(undefined);
    registrarCostoWhatsApp.mockReset(); registrarCostoWhatsApp.mockResolvedValue(undefined);
    logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    getCodigosPendientes.mockResolvedValue([]);
    // Sólo el código: sin gastos del mismo total al que pegarlo, `decidirFoto`
    // devuelve `pedir_ticket` y el acercamiento va a la bandeja de la 0016.
    extraerComprobante.mockResolvedValue({
      legible: false, motivo: 'solo_codigo',
      gasto: { id: 'g1', concepto: 'diesel', monto: 850, ocrExtra: { folioPortal: 'F-1' } },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
  });

  it('el acercamiento se guarda una vez y el turno termina', async () => {
    const r = await processInbound(foto);
    expect(guardarCodigoPendiente).toHaveBeenCalledTimes(1);
    expect(r).toBe('procesado');
  });

  // ── EL BUCLE ──────────────────────────────────────────────────────────────
  it('si el conteo falla Y el aviso lanza, el turno NO se abandona', async () => {
    // Era la cadena entera del hallazgo: el `say` del catch sin protección.
    // `procesado` significa que el claim se sella; `reintentable` significaría
    // que la bandeja vuelve a correr este mensaje y guarda el código otra vez.
    getCodigosPendientes.mockRejectedValue(new Error('base lenta'));
    registrarCostoWhatsApp.mockRejectedValue(new Error('registro de costo caído'));

    const r = await processInbound(foto);

    expect(r, 'un aviso que no sale no puede convertirse en una fila duplicada').toBe('procesado');
    expect(guardarCodigoPendiente).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('foto.codigo_aviso_falló', expect.objectContaining({ viaje: 'v1' }));
  });

  it('el conteo que falla se anota y AUN ASÍ se le da la instrucción al operador', async () => {
    // Dejarlo sin instrucción es peor que repetírsela: se queda esperando algo
    // que nadie le pidió.
    getCodigosPendientes.mockRejectedValue(new Error('base lenta'));

    await processInbound(foto);

    expect(logger.warn).toHaveBeenCalledWith('foto.codigos_no_contados', expect.objectContaining({ viaje: 'v1' }));
    expect(fetchSpy, 'el mensaje sí sale').toHaveBeenCalled();
  });
});
