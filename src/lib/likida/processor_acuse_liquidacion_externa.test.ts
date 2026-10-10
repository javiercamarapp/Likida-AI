import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL ACUSE DE UNA LIQUIDACIÓN EXTERNA ENTRA POR EL PROCESSOR (0370).
//
// Los dos botones del mensaje con que Likida entrega la liquidación que calculó
// el SAP del cliente llegan como TEXTO con el id del botón. Lo que se fija:
//
//   · se atiende AUNQUE el chofer no tenga viaje abierto — que es el caso
//     NORMAL: la liquidación llega cuando el viaje ya cerró. Sin esto su
//     respuesta caía en «no tienes viaje abierto» y el acuse nunca existía;
//   · el operador sale de SU teléfono (processor), no del id del botón;
//   · no pasa por el agente (una llamada al modelo para un botón es plata);
//   · lo que NO es un botón nuestro sigue su camino intacto;
//   · la respuesta solo afirma lo que de verdad se guardó.
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
// Un PostgREST de mentira ENCADENABLE: este camino (texto con viaje abierto)
// pasa por varias lecturas antes del botón, y una cadena a medias las tumba
// con un «se me trabó» que no es el hallazgo.
vi.mock('@/lib/supabase/admin', () => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in',
                   'gt', 'gte', 'lt', 'lte', 'not', 'or', 'order', 'limit', 'range', 'contains']) {
    enlace[m] = () => enlace;
  }
  enlace.maybeSingle = async () => ({ data: null, error: null });
  enlace.single = async () => ({ data: null, error: null });
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(r);
  return {
    supabaseAdmin: () => ({
      from: () => enlace,
      rpc: async () => ({ data: null, error: null }),
      storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) },
    }),
  };
});
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

// El circuito llama a `registrarAcuseConAviso` (el aviso a la oficina viaja con el acuse). El doble conserva la
// firma vieja `registrarAcuse(...) → resultado` para las pruebas y le suma el aviso que cada prueba programa.
let avisoOficina: 'enviado' | 'no_enviado' | 'no_aplica' = 'no_enviado';
const registrarAcuse = vi.fn(async (..._a: unknown[]): Promise<string> => 'registrado');
vi.mock('@/lib/likida/liquidacion_externa/servicio', () => ({
  registrarAcuseConAviso: async (...a: unknown[]) => ({ resultado: await registrarAcuse(...a), avisoOficina }),
}));


const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((b.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});


const LIQ_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const texto = (t: string) => ({ from: '5219993700779', type: 'text' as const, text: t, waMessageId: `wa-${t}` });

beforeEach(() => {
  salientes.length = 0;
  for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                   marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante, runAgent, getGastos]) m.mockReset();
  registrarAcuse.mockReset(); registrarAcuse.mockResolvedValue('registrado'); avisoOficina = 'no_enviado';
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  getOpenViaje.mockResolvedValue('v1');
  getHuerfanos.mockResolvedValue([]);
  getGastos.mockResolvedValue([]);
  runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
});

describe('el botón «Recibida»', () => {
  it('registra el acuse con el tenant y el operador del TELÉFONO, y contesta que quedó registrado', async () => {
    await processInbound(texto(`liqext_ok:${LIQ_ID}`));
    expect(registrarAcuse).toHaveBeenCalledWith('t1', 'o1', LIQ_ID, 'recibida');
    expect(salientes.join(' ')).toMatch(/quedó registrado que recibiste tu liquidación/i);
  });

  it('funciona SIN viaje abierto (el caso normal: la liquidación llega con el viaje ya cerrado)', async () => {
    getOpenViaje.mockResolvedValue(null);
    await processInbound(texto(`liqext_ok:${LIQ_ID}`));
    expect(registrarAcuse).toHaveBeenCalledTimes(1);
    expect(salientes.join(' ')).not.toMatch(/no tienes (un )?viaje abierto/i);
  });

  it('no gasta una llamada al modelo', async () => {
    await processInbound(texto(`liqext_ok:${LIQ_ID}`));
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('el id del botón en MAYÚSCULAS (un cliente raro lo reescribe) se normaliza y no se pierde', async () => {
    await processInbound(texto(`LIQEXT_OK:${LIQ_ID.toUpperCase()}`));
    expect(registrarAcuse).toHaveBeenCalledWith('t1', 'o1', LIQ_ID, 'recibida');
  });
});

describe('el botón «No coincide»', () => {
  it('registra el acuse negativo y, si el aviso a la oficina NO salió, le dice la verdad: quedó marcada en el panel', async () => {
    await processInbound(texto(`liqext_no:${LIQ_ID}`));
    expect(registrarAcuse).toHaveBeenCalledWith('t1', 'o1', LIQ_ID, 'no_coincide');
    const m = salientes.join(' ');
    expect(m).toMatch(/NO coincide/);
    expect(m).toMatch(/panel de tu oficina/);
    // No promete un aviso por WhatsApp que no se mandó.
    expect(m).not.toMatch(/ya le avis/i);
  });

  it('solo cuando Meta ACEPTÓ el aviso a la oficina se le promete «ya le avisé»', async () => {
    avisoOficina = 'enviado';
    await processInbound(texto(`liqext_no:${LIQ_ID}`));
    expect(salientes.join(' ')).toMatch(/Ya le avisé a tu oficina/);
  });
});

describe('lo que el servicio contesta', () => {
  it('una liquidación que no es suya (o no existe) se dice sin revelar de quién es', async () => {
    registrarAcuse.mockResolvedValue('no_encontrada');
    await processInbound(texto(`liqext_ok:${LIQ_ID}`));
    expect(salientes.join(' ')).toMatch(/No encontré esa liquidación en tu cuenta/);
  });

  it('apretar dos veces el mismo botón: «ya tenía registrada esa respuesta»', async () => {
    registrarAcuse.mockResolvedValue('ya_registrado');
    await processInbound(texto(`liqext_ok:${LIQ_ID}`));
    expect(salientes.join(' ')).toMatch(/Ya tenía registrada esa respuesta/);
  });

  it('si el registro TRUENA no se afirma «registrado»: se dice que no se pudo', async () => {
    registrarAcuse.mockRejectedValue(new Error('base caída'));
    await processInbound(texto(`liqext_ok:${LIQ_ID}`));
    const m = salientes.join(' ');
    expect(m).toMatch(/No pude registrar tu respuesta/);
    expect(m).not.toMatch(/quedó registrado/);
  });
});

describe('lo que NO es un botón nuestro sigue su camino', () => {
  it('un texto cualquiera llega al agente, intacto', async () => {
    await processInbound({ ...texto('listo'), timestampMs: 1788534000000 });
    expect(registrarAcuse).not.toHaveBeenCalled();
    // Siguió su camino: o llegó al agente, o el processor contestó algo por su cuenta.
    expect(runAgent.mock.calls.length + salientes.length).toBeGreaterThan(0);
  });

  it('un id parecido pero mal formado (uuid corto, prefijo ajeno) NO dispara el acuse', async () => {
    for (const t of ['liqext_ok:123', 'liqext_ok:', `liqext_xx:${LIQ_ID}`, `x liqext_ok:${LIQ_ID}`, `liqext_ok:${LIQ_ID} y más`]) {
      await processInbound({ ...texto(t), waMessageId: `wa-${t}` });
    }
    expect(registrarAcuse).not.toHaveBeenCalled();
  });

  it('el botón de acuse de un TICKET (ok:/mal:) sigue siendo del ticket', async () => {
    await processInbound(texto('ok:11111111-2222-4333-8444-555555555555'));
    expect(registrarAcuse).not.toHaveBeenCalled();
  });
});
