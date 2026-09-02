import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 — la sala de espera de comprobantes, tres huecos:
//
// · WA-2 (ALTO): el voucher de la terminal (o el acercamiento al código) que
//   llega SIN viaje entraba a la sala de espera CON el monto del papel. Con
//   viaje, `decidirFoto` ya sabe que ese voucher se PEGA al ticket y no se da
//   de alta; sin viaje, se ofrecía junto al ticket («Tengo 2 comprobantes
//   tuyos, $5,780») y un «sí» cobraba la misma carga dos veces.
// · WA-7 (MEDIO): el filtro de «solo los que tienen monto» vivía en un
//   `.filter` de JavaScript DESPUÉS del tope de 50 filas de la base.
// · BE-12 (MEDIO): un segundo «sí» sobre un huérfano ya insertado choca
//   contra `gasto_pkey` (el huérfano guarda el `gasto` con su id ya fijado),
//   no contra `uq_gasto_img_hash`; sin reconocerlo, el comprobante se
//   reofrecía en cada viaje, para siempre.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const guardarHuerfano = vi.fn();
const getHuerfanos = vi.fn();
const resolverHuerfanos = vi.fn();
const marcarHuerfanosOfrecidos = vi.fn();
const getOpenViaje = vi.fn();
const getGastos = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const runAgent = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/likida/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH') }));
vi.mock('@/lib/likida/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
  ligaComprobante: vi.fn(),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: (...a: unknown[]) => getOpenViaje(...a),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  addGasto: (...a: unknown[]) => addGasto(...a),
  guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...a),
  getHuerfanos: (...a: unknown[]) => getHuerfanos(...a),
  resolverHuerfanos: (...a: unknown[]) => resolverHuerfanos(...a),
  marcarHuerfanosOfrecidos: (...a: unknown[]) => marcarHuerfanosOfrecidos(...a),
  getGastos: (...a: unknown[]) => getGastos(...a), updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false), gastoPorHash: vi.fn(async () => null),
  corregirFechaGasto: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false),
  reclamarFotoPendiente: vi.fn(async () => null),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, origen: 'Silao', destino: 'N. Laredo', fechaInicio: '2026-08-01' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base'); }),
}));
vi.mock('@/lib/likida/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
    validacion: { fechaToleranciaDiasAntes: 30 },
  })),
}));
vi.mock('@/lib/likida/costos', () => ({
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
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) },
  }),
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));


const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((b.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa1' };
const texto = (t: string) => ({ from: '5219993700779', type: 'text' as const, text: t, waMessageId: `wa-${t}` });

const HUERFANO = (id: string, monto: number, ofrecido = false) => ({
  id, gasto: { id: `g-${id}`, concepto: 'diesel', monto, ocrExtra: {} },
  motivo: 'sin_viaje' as const, creadoEn: '2026-07-31T10:00:00Z',
  ofrecidoEn: ofrecido ? '2026-08-01T10:00:00Z' : undefined,
});

/** El 23505 que Postgres devuelve cuando el índice que se viola es el de la
 *  llave primaria de `gasto` (menor OID: se evalúa antes que los únicos). */
const CHOQUE = (indice: string) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${indice}"`), { code: '23505' });

function base() {
  salientes.length = 0;
  for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                   marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante, runAgent, getGastos]) m.mockReset();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  getHuerfanos.mockResolvedValue([]);
  getGastos.mockResolvedValue([]);
  guardarHuerfano.mockResolvedValue(true);
  subirComprobante.mockResolvedValue('t1/sin-viaje/HASH.jpg');
  addGasto.mockResolvedValue(undefined);
  resolverHuerfanos.mockResolvedValue(true);
  runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
}

// ── WA-2 ──────────────────────────────────────────────────────────────────
describe('WA-2 · el voucher de la terminal sin viaje NO entra como gasto', () => {
  beforeEach(() => { base(); getOpenViaje.mockResolvedValue(null); });

  const voucher = {
    legible: false, motivo: 'solo_pago' as const,
    gasto: { concepto: 'diesel', monto: 5780, fecha: '2026-07-31', ocrExtra: { terminal: 'BBVA' } },
    costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
  };

  it('EL FALLO: se guarda con monto 0, no con los $5,780 del papel', async () => {
    extraerComprobante.mockResolvedValue(voucher);
    await processInbound(foto);
    expect(guardarHuerfano).toHaveBeenCalledTimes(1);
    const arg = guardarHuerfano.mock.calls[0][2] as { gasto: { monto: number; ocrExtra: Record<string, unknown> } };
    expect(arg.gasto.monto, 'con monto, un «sí» lo cobra encima del ticket').toBe(0);
    expect(arg.gasto.ocrExtra.documento).toBe('voucher_pago');
    expect(arg.gasto.ocrExtra.montoDelPapel, 'la cifra del papel se conserva para la oficina').toBe(5780);
  });

  it('y se lo dice: es el voucher, no el ticket, y el ticket es lo que cuenta', async () => {
    extraerComprobante.mockResolvedValue(voucher);
    await processInbound(foto);
    const m = salientes.join(' ');
    expect(m).toMatch(/voucher de la terminal/i);
    expect(m).toMatch(/ticket/i);
    expect(m, 'no se le pide reenviar la MISMA foto: no es problema de la foto').not.toMatch(/buena luz/i);
  });

  it('el acercamiento al código es el otro caso, con su propio texto', async () => {
    extraerComprobante.mockResolvedValue({ ...voucher, motivo: 'solo_codigo' });
    await processInbound(foto);
    const arg = guardarHuerfano.mock.calls[0][2] as { gasto: { monto: number; ocrExtra: Record<string, unknown> } };
    expect(arg.gasto.monto).toBe(0);
    expect(arg.gasto.ocrExtra.documento).toBe('acercamiento_codigo');
    expect(salientes.join(' ')).toMatch(/acercamiento al código/i);
  });

  it('y si no se pudo guardar, se lo dice — no le deja creer que quedó', async () => {
    extraerComprobante.mockResolvedValue(voucher);
    guardarHuerfano.mockResolvedValue(false);
    await processInbound(foto);
    expect(salientes.join(' ')).toMatch(/No pude guardar ese comprobante/i);
  });

  it('una foto de verdad ilegible (borrosa) sigue pidiéndose otra vez, sin guardar nada', async () => {
    extraerComprobante.mockResolvedValue({ ...voucher, motivo: 'borrosa' });
    await processInbound(foto);
    expect(guardarHuerfano).not.toHaveBeenCalled();
    expect(salientes.join(' ')).toMatch(/buena luz/i);
  });
});

// ── WA-7 y BE-12 ──────────────────────────────────────────────────────────
describe('WA-7 · el filtro de monto lo hace la base, antes del tope de 50', () => {
  beforeEach(() => { base(); getOpenViaje.mockResolvedValue('v1'); });

  it('la oferta pide a la base solo los que tienen monto', async () => {
    await processInbound(texto('hola'));
    expect(getHuerfanos).toHaveBeenCalledWith('t1', 'o1', { soloConMonto: true });
  });
});

describe('BE-12 · el segundo «sí» reconoce el choque contra gasto_pkey', () => {
  beforeEach(() => { base(); getOpenViaje.mockResolvedValue('v1'); });

  it('EL FALLO: `gasto_pkey` cuenta como resuelto (el gasto YA está en el viaje)', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true), HUERFANO('b', 200, true)]);
    addGasto.mockRejectedValueOnce(CHOQUE('gasto_pkey')).mockResolvedValueOnce(undefined);
    await processInbound(texto('sí'));
    expect(resolverHuerfanos, 'sin esto, «a» se reofrece en cada viaje para siempre')
      .toHaveBeenCalledWith('t1', ['a', 'b'], 'adjuntado', 'v1');
  });

  it('un fallo distinto sigue sin marcarse, y el log nombra la fila y el gasto', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true)]);
    addGasto.mockRejectedValue(new Error('boom'));
    await processInbound(texto('sí'));
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', [], 'adjuntado', 'v1');
    expect(logger.error).toHaveBeenCalledWith('huerfano.adjuntar_error',
      expect.objectContaining({ huerfanoId: 'a', gastoId: 'g-a', viaje: 'v1' }));
  });

  it('si el sello falla, queda dicho en la bitácora con los ids (el dinero SÍ entró)', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true)]);
    resolverHuerfanos.mockResolvedValue(false);
    await processInbound(texto('sí'));
    expect(logger.error).toHaveBeenCalledWith('huerfano.sin_sellar',
      expect.objectContaining({ viaje: 'v1', huerfanos: ['a'] }));
  });
});
