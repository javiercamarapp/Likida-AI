import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, ALTO REINCIDENTE backend — dos sub-caminos del árbol de imagen
// sin integración real desde la ronda 8: `pedir_ticket` solo tenía una prueba
// que lee `processor.ts` como TEXTO (`aviso_una_vez.test.ts`, con
// `readFileSync` + `indexOf` + `toMatch` contra el string fuente), y
// `enriquecer` no tenía NINGUNA prueba, ni siquiera textual. El propio commit
// `a66b828` (ronda 8) lo dejó escrito: "Faltan aún pedir_ticket/enriquecer del
// protocolo de código pendiente... quedan para la próxima ronda."
//
// El riesgo que eso deja abierto: alguien invierte `pendientes.length <= 1`
// por `>= 1`, o borra el `getCodigosPendientes` y deja un `true` fijo, y la
// suite completa (1500+ pruebas) sigue en verde con el bug de los TRES avisos
// idénticos (el que motivó `aviso_una_vez.test.ts`) de vuelta — porque un test
// de texto solo prueba que el STRING sigue en el archivo, no que el CÓDIGO
// hace lo que el string dice.
//
// Este archivo corre `processInbound` de verdad para los dos caminos:
//   · pedir_ticket: un acercamiento/voucher SIN ticket que emparejar.
//   · enriquecer:   el mismo acercamiento, con el ticket YA registrado.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const extraerComprobante = vi.fn();
const getGastos = vi.fn();
const guardarCodigoPendiente = vi.fn();
const getCodigosPendientes = vi.fn();
const enriquecerGastoConCodigo = vi.fn();
const addGasto = vi.fn();
const gastoExistePorHash = vi.fn();
const subirComprobante = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/cuadra/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH-DE-LA-FOTO') }));
vi.mock('@/lib/cuadra/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
  ligaComprobante: vi.fn(),
}));
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
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => addGasto(...a),
  corregirFechaGasto: vi.fn(),
  gastoExistePorHash: (...a: unknown[]) => gastoExistePorHash(...a),
  gastoPorHash: vi.fn(async () => null),
  getGastos: (...a: unknown[]) => getGastos(...a),
  updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  enriquecerGastoConCodigo: (...a: unknown[]) => enriquecerGastoConCodigo(...a),
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
vi.mock('@/lib/cuadra/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
    validacion: { fechaToleranciaDiasAntes: 30 },
  })),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
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

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: 'wa1' };

const ACERCAMIENTO_SOLO_CODIGO = {
  legible: false,
  motivo: 'solo_codigo' as const,
  gasto: { concepto: 'diesel', monto: 850, fecha: '2026-08-01', ocrExtra: { codigoBarras: '7501234567890' } },
  costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
};

const VOUCHER_SOLO_PAGO = {
  legible: false,
  motivo: 'solo_pago' as const,
  gasto: { concepto: 'diesel', monto: 850, fecha: '2026-08-01', ocrExtra: {} },
  costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
};

const TICKET_DIESEL = { id: 'g-diesel', concepto: 'diesel', monto: 850, fecha: '2026-08-01', folio: undefined };

function resetTodo() {
  salientes.length = 0;
  for (const m of [runAgent, extraerComprobante, getGastos, guardarCodigoPendiente, getCodigosPendientes,
    enriquecerGastoConCodigo, addGasto, gastoExistePorHash, subirComprobante]) m.mockReset();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  gastoExistePorHash.mockResolvedValue(false);
  subirComprobante.mockResolvedValue('t1/v1/HASH.jpg');
  guardarCodigoPendiente.mockResolvedValue(undefined);
  getCodigosPendientes.mockResolvedValue([]);
  enriquecerGastoConCodigo.mockResolvedValue(true);
  addGasto.mockResolvedValue(undefined);
  runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
}

describe('processInbound — pedir_ticket: acercamiento SIN ticket que emparejar', () => {
  beforeEach(() => {
    resetTodo();
    getGastos.mockResolvedValue([]); // nada que emparejar → pedir_ticket
  });

  it('un código (solo_codigo) SIN ticket registrado pide el ticket completo, no da de alta nada', async () => {
    extraerComprobante.mockResolvedValue(ACERCAMIENTO_SOLO_CODIGO);

    await processInbound(foto);

    expect(addGasto, 'un código por su cuenta no vale como gasto').not.toHaveBeenCalled();
    expect(guardarCodigoPendiente).toHaveBeenCalledWith('t1', 'v1', expect.objectContaining({ monto: 850 }));
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/ticket completo/i);
  });

  it('un voucher de terminal (solo_pago) pide el OTRO papel, no "el ticket completo"', async () => {
    // El voucher YA es el papel completo de la terminal; pedirle "el ticket
    // completo" lo manda a esperar algo que no existe (decidir.ts::porVoucher).
    extraerComprobante.mockResolvedValue(VOUCHER_SOLO_PAGO);

    await processInbound(foto);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/comercio/i);
    expect(salientes[0]).not.toMatch(/ticket completo/i);
  });

  it('el aviso sale UNA sola vez por viaje: con otro código YA pendiente, se calla', async () => {
    // `getCodigosPendientes` refleja el estado DESPUÉS del `guardarCodigoPendiente`
    // de este mismo turno: 2 significa que éste es el segundo del viaje.
    extraerComprobante.mockResolvedValue(ACERCAMIENTO_SOLO_CODIGO);
    getCodigosPendientes.mockResolvedValue([{ id: 'cp-1' }, { id: 'cp-2' }]);

    await processInbound(foto);

    expect(guardarCodigoPendiente, 'el código se guarda siempre, sea o no el primero').toHaveBeenCalled();
    expect(salientes, 'el SEGUNDO acercamiento no repite el aviso').toHaveLength(0);
  });

  it('si no se puede contar los pendientes, avisa de todos modos (degrada al lado seguro)', async () => {
    extraerComprobante.mockResolvedValue(ACERCAMIENTO_SOLO_CODIGO);
    getCodigosPendientes.mockRejectedValue(new Error('blip de red'));

    await processInbound(foto);

    expect(salientes, 'perder el aviso deja al operador sin instrucción, y eso es peor').toHaveLength(1);
    expect(salientes[0]).toMatch(/ticket completo/i);
  });
});

describe('processInbound — enriquecer: el mismo acercamiento, con el ticket YA registrado', () => {
  beforeEach(() => {
    resetTodo();
    getGastos.mockResolvedValue([TICKET_DIESEL]); // hay con qué emparejar → enriquecer
  });

  it('le pega el código al gasto existente y NO da de alta uno nuevo', async () => {
    extraerComprobante.mockResolvedValue(ACERCAMIENTO_SOLO_CODIGO);

    await processInbound(foto);

    expect(enriquecerGastoConCodigo).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ id: 'g-diesel' }),
      expect.objectContaining({ codigoBarras: '7501234567890' }),
    );
    expect(addGasto, 'el ticket ya existe: sumar el código lo cobraría dos veces').not.toHaveBeenCalled();
  });

  it('es silencioso: el acuse de la ráfaga ya lo dio la primera foto', async () => {
    extraerComprobante.mockResolvedValue(ACERCAMIENTO_SOLO_CODIGO);

    await processInbound(foto);

    expect(salientes, 'un aviso aquí sería el mismo ruido que ya se resolvió para pedir_ticket').toHaveLength(0);
  });

  it('un RPC roto (0017 no aplicada) no tumba el procesamiento — se registra el error y se sigue', async () => {
    extraerComprobante.mockResolvedValue(ACERCAMIENTO_SOLO_CODIGO);
    enriquecerGastoConCodigo.mockRejectedValue(new Error('function enriquecer_gasto_con_codigo does not exist'));

    await processInbound(foto);

    expect(logger.error).toHaveBeenCalledWith('foto.acercamiento_error', expect.anything());
    expect(salientes, 'best-effort: el gasto ya está registrado con su monto, no hace falta reintento de Meta').toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// El acuse de la ráfaga ("Voy recibiendo tus comprobantes"), atado al PRIMER
// comprobante del viaje — el precedente del que sale el criterio "una vez por
// viaje" que rige `pedir_ticket` arriba. Antes solo tenía cobertura de TEXTO
// (`aviso_una_vez.test.ts`, retirado por este mismo commit): ese archivo leía
// `P.toMatch(/registrados\.length === 1/)` contra el string fuente, que sigue
// en verde aunque alguien invierta la condición o rompa el conteo.
// ═══════════════════════════════════════════════════════════════════════════
describe('processInbound — el acuse de la ráfaga sale con el PRIMER comprobante del viaje', () => {
  beforeEach(() => {
    resetTodo();
    extraerComprobante.mockResolvedValue({
      legible: true,
      gasto: { concepto: 'diesel', monto: 850, fecha: '2026-08-01', folio: 'A1', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
  });

  it('con éste como el primer gasto del viaje, manda el acuse', async () => {
    // Antes del alta (emparejamiento de fecha): nada. Después del alta (conteo
    // del acuse): un gasto — éste mismo, recién insertado.
    getGastos.mockResolvedValueOnce([]).mockResolvedValueOnce([TICKET_DIESEL]);

    await processInbound(foto);

    expect(salientes.some((s) => s.includes('Voy recibiendo tus comprobantes'))).toBe(true);
  });

  it('con un gasto YA en el viaje, el segundo comprobante NO repite el acuse', async () => {
    // Antes del alta: ya había uno. Después del alta: dos.
    getGastos.mockResolvedValueOnce([TICKET_DIESEL]).mockResolvedValueOnce([TICKET_DIESEL, { ...TICKET_DIESEL, id: 'g2' }]);

    await processInbound(foto);

    expect(salientes.some((s) => s.includes('Voy recibiendo tus comprobantes'))).toBe(false);
  });
});
