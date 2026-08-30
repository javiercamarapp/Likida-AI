import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21 · CRÍTICO (C1) — un `PartialExecutionError` posterior a
// `guardar_liquidacion` dejaba al chofer con "se me trabó" sobre un viaje que
// YA cerró de verdad, y su reintento le mentía que no existe.
//
// El escenario completo, con la base diciendo una cosa y el chofer creyendo
// otra: `runAgent` ejecuta `guardar_liquidacion` con éxito (viaje `liquidado`,
// PDFs generados) pero una ronda posterior del ciclo truena y lanza
// `PartialExecutionError` CON esa tool exitosa en `partialToolCalls`. La
// recuperación existía desde AUDIT_V3… detrás de un flag opt-in APAGADO por
// default (`LIKIDA_RECUPERAR_CIERRE_PARCIAL === '1'`). De fábrica:
//
//   1. el chofer recibía "Perdón, se me trabó el sistema tantito. ¿Me reenvías
//      tu último mensaje?" — sobre una liquidación REAL ya persistida;
//   2. obedecía, `getOpenViaje` devolvía null (el viaje ya es `liquidado`) y
//      el fallback le afirmaba "No tienes un viaje abierto para liquidar" —
//      la negación de un cierre que sí existe, con PDF y cifras reales;
//   3. la bandeja durable sellaba el mensaje como 'procesado': ningún
//      mecanismo automático cerraba la brecha.
//
// El arreglo tiene dos piezas y este archivo fija las dos:
//   · la recuperación decide por EVIDENCIA, no por flag: si `partialToolCalls`
//     trae `guardar_liquidacion` exitoso, el cierre ocurrió y se le dice la
//     verdad (default ENCENDIDO; `LIKIDA_RECUPERAR_CIERRE_PARCIAL=0` es el
//     apagador de emergencia);
//   · el reintento sin viaje abierto consulta si hay una liquidación RECIENTE
//     del operador y confirma el cierre en vez de sugerir que no pasó nada.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const createSignedUrl = vi.fn();
const saveConversation = vi.fn();
const loadConversation = vi.fn(async () => ({
  id: 'c1',
  turns: [] as { role: 'user' | 'assistant'; content: string }[],
  // La mayoría de estas pruebas cubren lo que pasa DESPUÉS del intento de
  // cierre; con `false` el "listo" se queda en el freno y nunca llega al agente.
  cierreSinComprobantes: true,
}));
const getOpenViaje = vi.fn<(tenantId: string, operadorId: string) => Promise<string | null>>(async () => 'v1');
const liquidacionReciente = vi.fn<(tenantId: string, operadorId: string) => Promise<{ viajeId: string; liquidacionId: string } | null>>(async () => null);
const claimMessage = vi.fn<(id: string) => Promise<'nuevo' | 'duplicado' | 'indeterminado'>>(async () => 'nuevo');
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// ── EL ÚNICO BORDE: la Graph API ────────────────────────────────────────────
type Salida = { url: string; body: Record<string, unknown> };
const salientes: Salida[] = [];

const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/messages')) {
    salientes.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    return ok({ messages: [{ id: 'wamid.TEST' }] });
  }
  return ok({ url: `https://media.test/x`, mime_type: 'text/xml' });
});

/** Los mensajes de texto que salieron hacia Meta, en orden. */
const textos = () => salientes.filter((s) => s.body.type === 'text').map((s) => String((s.body.text as { body: string }).body));
const documentos = () => salientes.filter((s) => s.body.type === 'document');

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: (t: string, o: string) => getOpenViaje(t, o),
  liquidacionRecienteDe: (t: string, o: string) => liquidacionReciente(t, o),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: (...a: unknown[]) => loadConversation(...(a as [])),
  saveConversation: (...a: unknown[]) => saveConversation(...a),
  claimMessage: (...a: unknown[]) => claimMessage(...(a as [string])),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const),
  releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida',
    urlAvisoIntegral: 'https://flota.mx/privacidad',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
  getPerfilCrudo: vi.fn(async () => ({})),
}));
const vincularCostosALiquidacion = vi.fn();
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'),
  vincularCostosALiquidacion: (...a: unknown[]) => vincularCostosALiquidacion(...a),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (_tabla: string) => {
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['select', 'eq', 'gte', 'lte', 'or', 'order', 'in', 'is', 'limit']) b[m] = self;
      b.range = async () => ({ data: [], error: null, count: 0 });
      b.maybeSingle = async () => ({ data: null, error: null });
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return b;
    },
    storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a), upload: async () => ({ error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

// ── El motor determinístico, mockeado en su borde (mismo criterio que
// `processor_llm_caido.test.ts`): lo que se prueba es que el processor lo usa
// para decirle la VERDAD al chofer, no la aritmética del cuadre. ─────────────
const cuadrarDesdeDB = vi.fn(async () => ({ totalComprobado: 1234 }));
vi.mock('@/lib/likida/cuadre/desde_db', () => ({
  cuadrarDesdeDB: (...a: unknown[]) => cuadrarDesdeDB(...(a as [])),
  ventanaDesdeDB: vi.fn(async () => null),
}));
vi.mock('@/lib/likida/cuadre/resumen', () => ({
  resumenCuadre: (_liq: unknown, cerrado: boolean) => `CUADRE REAL (cerrado=${cerrado})`,
}));

const avisarCierreAlJefe = vi.fn(async (_a: unknown) => ({ enviado: true }));
vi.mock('./avisar_cierre', () => ({ avisarCierreAlJefe: (a: unknown) => avisarCierreAlJefe(a) }));

const { processInbound } = await import('./processor');
const { PartialExecutionError } = await import('@/lib/llm/openrouter');

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };

/** El agente MURIÓ a media ronda, pero `guardar_liquidacion` YA había corrido
 *  con éxito: la liquidación existe en la base, con sus dos PDFs. */
const cierreParcial = () => new PartialExecutionError(
  'timeout del proveedor',
  new Error('timeout del proveedor'),
  [{ toolName: 'guardar_liquidacion', args: {}, result: { liquidacion_id: 'L1', pdf_generado: true, pdf_contralor_generado: true }, durationMs: 5 }],
  10, 10, 0,
);

beforeEach(() => {
  salientes.length = 0;
  runAgent.mockReset(); createSignedUrl.mockReset();
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/liq.pdf' }, error: null });
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  getOpenViaje.mockReset(); getOpenViaje.mockResolvedValue('v1');
  liquidacionReciente.mockReset(); liquidacionReciente.mockResolvedValue(null);
  claimMessage.mockReset(); claimMessage.mockResolvedValue('nuevo');
  saveConversation.mockReset(); saveConversation.mockResolvedValue(undefined);
  loadConversation.mockReset();
  loadConversation.mockResolvedValue({ id: 'c1', turns: [], cierreSinComprobantes: true });
  vincularCostosALiquidacion.mockReset();
  cuadrarDesdeDB.mockReset(); cuadrarDesdeDB.mockResolvedValue({ totalComprobado: 1234 });
  avisarCierreAlJefe.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  // DE FÁBRICA: sin el flag configurado. Es exactamente el entorno donde la
  // auditoría 21 encontró el hallazgo — el default tiene que decir la verdad.
  delete process.env.LIKIDA_RECUPERAR_CIERRE_PARCIAL;
});

describe('C1 — el cierre que SÍ ocurrió se recupera DE FÁBRICA, sin flag', () => {
  it('el chofer recibe la verdad (cierre confirmado con cifras del motor), no "se me trabó"', async () => {
    runAgent.mockRejectedValue(cierreParcial());
    await processInbound(listo);

    const dichos = textos().join(' | ');
    expect(dichos, 'le pidió reenviar sobre un viaje ya liquidado').not.toContain('reenvías');
    expect(dichos).toContain('CUADRE REAL (cerrado=true)');
    expect(logger.warn).toHaveBeenCalledWith('agent.cierre_parcial_recuperado', expect.objectContaining({ viaje: 'v1', liqId: 'L1' }));
  });

  it('y recibe su PDF: la liquidación existe y el documento también', async () => {
    runAgent.mockRejectedValue(cierreParcial());
    await processInbound(listo);
    expect(documentos()).toHaveLength(1);
  });

  it('el jefe también se entera — el circuito del cierre se completa igual que en el camino feliz', async () => {
    runAgent.mockRejectedValue(cierreParcial());
    await processInbound(listo);
    expect(avisarCierreAlJefe).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', viajeId: 'v1' }));
  });

  it('los costos del ciclo se vinculan a la liquidación recuperada', async () => {
    runAgent.mockRejectedValue(cierreParcial());
    await processInbound(listo);
    expect(vincularCostosALiquidacion).toHaveBeenCalledWith('t1', 'v1', 'L1');
  });

  it('LIKIDA_RECUPERAR_CIERRE_PARCIAL=0 sigue siendo el apagador de emergencia', async () => {
    process.env.LIKIDA_RECUPERAR_CIERRE_PARCIAL = '0';
    runAgent.mockRejectedValue(cierreParcial());
    await processInbound(listo);
    expect(logger.warn).not.toHaveBeenCalledWith('agent.cierre_parcial_recuperado', expect.anything());
    expect(documentos()).toHaveLength(0);
  });

  it('control: un PartialExecutionError SIN guardar_liquidacion no inventa un cierre', async () => {
    runAgent.mockRejectedValue(new PartialExecutionError(
      'boom', new Error('boom'),
      [{ toolName: 'cuadrar_viaje', args: {}, result: {}, durationMs: 5 }],
      10, 10, 0,
    ));
    await processInbound(listo);
    expect(logger.warn).not.toHaveBeenCalledWith('agent.cierre_parcial_recuperado', expect.anything());
    expect(documentos()).toHaveLength(0);
    // No se afirma cierre en ningún texto saliente.
    expect(textos().join(' | ')).not.toContain('cerrado=true');
  });
});

describe('C1 — el reintento sin viaje abierto no niega un cierre reciente', () => {
  beforeEach(() => { getOpenViaje.mockResolvedValue(null); });

  it('con una liquidación reciente del operador, se le CONFIRMA el cierre', async () => {
    liquidacionReciente.mockResolvedValue({ viajeId: 'v1', liquidacionId: 'L1' });
    await processInbound(listo);
    const dichos = textos().join(' | ');
    expect(dichos, 'negó un cierre que sí existe').not.toMatch(/No tienes un viaje abierto para liquidar/i);
    expect(dichos).toMatch(/liquidad/i);
    expect(dichos).toMatch(/contralor|panel/i);
  });

  it('sin liquidación reciente, el mensaje de siempre (regresión)', async () => {
    liquidacionReciente.mockResolvedValue(null);
    await processInbound(listo);
    expect(textos().join(' | ')).toMatch(/No tienes un viaje abierto/i);
  });

  it('si la consulta de la liquidación reciente truena, no se cae el turno: mensaje de siempre', async () => {
    liquidacionReciente.mockRejectedValue(new Error('base caída'));
    await processInbound(listo);
    expect(textos().join(' | ')).toMatch(/No tienes un viaje abierto/i);
  });
});
