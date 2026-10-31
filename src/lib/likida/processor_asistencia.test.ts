import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El CABLEADO de la asistencia (0198, Fase 4) en el dispatcher — lo que las
// unidades no pueden probar:
//
//   · ROJO le gana a talacha: "chocamos y la talacha cobra 800" es un choque;
//   · el caption ROJO de una foto NO paga visión, NO abre gasto y NO toca la
//     barrera — el bug activo del plano ("esa foto salió difícil de leer"
//     mientras la unidad arde) queda cerrado;
//   · en la oficina, el botón `asi_ok:` y el ROJO del dueño corren ANTES que
//     talacha/despacho/analista;
//   · "ya llegué" y la talacha real siguen siendo suyos — la frontera vive.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const resolveOperador = vi.fn();
const resolverCuentaOficina = vi.fn();
const atenderAsistenciaChofer = vi.fn();
const atenderReconocimientoAsistencia = vi.fn();
const atenderAsistenciaOficina = vi.fn();
const atenderTalachaChofer = vi.fn();
const atenderAutorizacionTalacha = vi.fn();
const atenderDespachoOficina = vi.fn();
const atenderInformeOficina = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const decidirFoto = vi.fn();
const addGasto = vi.fn();
const intakeDelta = vi.fn();
const sendText = vi.fn();
const sendButtons = vi.fn();
const registrarSolicitudArco = vi.fn();
const pipelineTenantApagado = vi.fn();
const contactoVigia = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/asistencia_wa', async (original) => ({
  // El RECONOCEDOR es el real: lo mockeado es el efecto (DB + jefe).
  ...(await original<Record<string, unknown>>()),
  atenderAsistenciaChofer: (...a: unknown[]) => atenderAsistenciaChofer(...a),
  atenderReconocimientoAsistencia: (...a: unknown[]) => atenderReconocimientoAsistencia(...a),
  atenderAsistenciaOficina: (...a: unknown[]) => atenderAsistenciaOficina(...a),
}));
vi.mock('@/lib/likida/talacha_wa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  atenderTalachaChofer: (...a: unknown[]) => atenderTalachaChofer(...a),
  atenderAutorizacionTalacha: (...a: unknown[]) => atenderAutorizacionTalacha(...a),
}));
vi.mock('@/lib/likida/despacho_wa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  atenderDespachoOficina: (...a: unknown[]) => atenderDespachoOficina(...a),
}));
vi.mock('@/lib/likida/asignar_wa', () => ({
  atenderAsignacionOficina: vi.fn(async () => null),
}));
vi.mock('@/lib/likida/informes_wa', () => ({
  atenderInformeOficina: (...a: unknown[]) => atenderInformeOficina(...a),
}));
vi.mock('@/lib/likida/contactos', () => ({
  resolverCuentaOficina: (...a: unknown[]) => resolverCuentaOficina(...a),
  telefonoJefeDe: vi.fn(async () => null),
  telefonosJefe: vi.fn(async () => ({})),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: (...a: unknown[]) => intakeDelta(...a),
  esperarIntake: vi.fn(async () => true),
  buscarOperadorPorTelefono: vi.fn(async () => null),
}));
vi.mock('@/lib/likida/confirmar_viaje', () => ({
  atenderConfirmacion: vi.fn(async () => ({ mensaje: null, estado: 'nada' })),
  aceptarPorActividad: vi.fn(),
}));
vi.mock('@/lib/likida/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
}));
vi.mock('@/lib/likida/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
}));
vi.mock('@/lib/likida/intake/decidir', () => ({
  decidirFoto: (...a: unknown[]) => decidirFoto(...a),
}));
vi.mock('@/lib/likida/cuadre/desde_db', () => ({
  cuadrarDesdeDB: vi.fn(),
  ventanaDesdeDB: vi.fn(async () => undefined),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => addGasto(...a),
  getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  gastoPorHash: vi.fn(async () => null), corregirFechaGasto: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), confirmarEnvioAviso: vi.fn(),
  liberarEnvioAviso: vi.fn(), registrarSolicitudArco: (...a: unknown[]) => registrarSolicitudArco(...a),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', () => ({
  MAX_CUERPO_BOTONES: 1024,
  sendText: (...a: unknown[]) => sendText(...a),
  sendButtons: (...a: unknown[]) => sendButtons(...a),
  sendDocument: vi.fn(async () => 'wamid.DOC'),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,QUJDREVGRw=='),
  downloadMediaAsText: vi.fn(async () => null),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
  }),
}));
vi.mock('@/lib/likida/interruptor_tenant', () => ({
  pipelineTenantApagado: (...a: unknown[]) => pipelineTenantApagado(...a),
}));
vi.mock('./vigia/repo', () => ({
  crearRepoVigia: () => ({ contactoPorTelefono: (...a: unknown[]) => contactoVigia(...a) }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');

const CHOFER_TEL = '5219993700779';
const OFICINA_TEL = '5215550000001';
const CUENTA = { userId: 'u-jefe', tenantId: 't1', rol: 'flota_admin', nombre: 'Rodrigo', email: 'j@x.mx' };
const INC = '11111111-2222-3333-4444-555555555555';

let n = 0;
function texto(from: string, t: string) {
  return { from, type: 'text' as const, text: t, waMessageId: `wa-${n++}` };
}
function foto(from: string, caption?: string) {
  return { from, type: 'image' as const, mediaId: 'media-1', text: caption, waMessageId: `wa-${n++}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveOperador.mockResolvedValue({ tenantId: 't1', operadorId: 'o1' });
  resolverCuentaOficina.mockResolvedValue(null);
  sendText.mockResolvedValue('wamid.TXT');
  sendButtons.mockResolvedValue('wamid.BTN');
  intakeDelta.mockResolvedValue(1);
  subirComprobante.mockResolvedValue('comprobantes/t1/v1/x.jpg');
  extraerComprobante.mockResolvedValue({
    legible: true,
    gasto: { id: 'g-ocr', concepto: 'otro', monto: 950, ocrConfianza: 0.9 },
    costo: { modelo: 'vision', tokensIn: 10, tokensOut: 5, costoUsd: 0.001 },
  });
  decidirFoto.mockReturnValue({ accion: 'registrar' });
  atenderAsistenciaChofer.mockResolvedValue({ atendida: true, respuesta: 'EMERGENCIA_ATENDIDA' });
  atenderReconocimientoAsistencia.mockResolvedValue(null);
  atenderAsistenciaOficina.mockResolvedValue(null);
  atenderTalachaChofer.mockResolvedValue('TALACHA_ANOTADA');
  atenderAutorizacionTalacha.mockResolvedValue(null);
  atenderDespachoOficina.mockResolvedValue(null);
  atenderInformeOficina.mockResolvedValue(null);
  registrarSolicitudArco.mockResolvedValue(true);
  pipelineTenantApagado.mockResolvedValue(false);
  contactoVigia.mockResolvedValue(null);
});

describe('el chofer — ROJO por texto', () => {
  it('"chocamos, hay un herido" abre el circuito con nivel/lesionados y NO corre el agente', async () => {
    await processInbound(texto(CHOFER_TEL, 'chocamos, hay un herido'));
    expect(atenderAsistenciaChofer).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      asistencia: { nivel: 'rojo', modoMudo: false },
    }));
    expect(sendText.mock.calls.some((c) => String(c[1]).includes('EMERGENCIA_ATENDIDA'))).toBe(true);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('ROJO le GANA a talacha: "chocamos y la talacha cobra 800" es un choque, no una avería', async () => {
    await processInbound(texto(CHOFER_TEL, 'chocamos y la talacha cobra 800'));
    expect(atenderAsistenciaChofer).toHaveBeenCalled();
    expect(atenderTalachaChofer).not.toHaveBeenCalled();
  });

  it('el ámbar con viaje también llega al circuito ("me quedé varado")', async () => {
    await processInbound(texto(CHOFER_TEL, 'me quedé varado en la caseta'));
    expect(atenderAsistenciaChofer).toHaveBeenCalledWith(expect.objectContaining({
      asistencia: { nivel: 'ambar', modoMudo: false },
    }));
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('"ya llegué" sigue siendo un hito y la talacha real sigue siendo talacha — la frontera vive', async () => {
    await processInbound(texto(CHOFER_TEL, 'ya llegué'));
    expect(atenderAsistenciaChofer).not.toHaveBeenCalled();

    await processInbound(texto(CHOFER_TEL, 'se me ponchó una llanta, la talacha son 800'));
    expect(atenderAsistenciaChofer).not.toHaveBeenCalled();
    expect(atenderTalachaChofer).toHaveBeenCalled();
  });
});

describe('el chofer — el caption ROJO de una foto (el bug activo del plano)', () => {
  it('la foto del camión volcado NO paga visión, NO abre gasto y NO toca la barrera', async () => {
    await processInbound(foto(CHOFER_TEL, 'se volcó el camión, volcadura fea'));
    expect(atenderAsistenciaChofer).toHaveBeenCalledWith(expect.objectContaining({
      texto: 'se volcó el camión, volcadura fea',
      asistencia: expect.objectContaining({ nivel: 'rojo' }),
    }));
    expect(extraerComprobante).not.toHaveBeenCalled();   // ni visión
    expect(addGasto).not.toHaveBeenCalled();             // ni gasto
    expect(intakeDelta).not.toHaveBeenCalled();          // ni barrera
    expect(sendText.mock.calls.some((c) => String(c[1]).includes('EMERGENCIA_ATENDIDA'))).toBe(true);
  });

  it('un caption ÁMBAR sigue el camino normal de comprobante (la foto puede ser un ticket legítimo)', async () => {
    await processInbound(foto(CHOFER_TEL, 'humo del motor, aquí la nota de la refaccionaria'));
    expect(addGasto).toHaveBeenCalled();
    expect(extraerComprobante).toHaveBeenCalled();
  });

  it('una foto sin caption sigue el camino de comprobante de siempre', async () => {
    await processInbound(foto(CHOFER_TEL));
    expect(addGasto).toHaveBeenCalled();
    expect(atenderAsistenciaChofer).not.toHaveBeenCalled();
  });
});

describe('la oficina — el botón y el ROJO del dueño', () => {
  beforeEach(() => {
    resolveOperador.mockResolvedValue(null);
    resolverCuentaOficina.mockResolvedValue(CUENTA);
  });

  it('el botón asi_ok corre PRIMERO — antes de talacha, despacho y analista', async () => {
    atenderReconocimientoAsistencia.mockResolvedValue('RECONOCIDA ✅');
    await processInbound(texto(OFICINA_TEL, `asi_ok:${INC}`));
    expect(atenderReconocimientoAsistencia).toHaveBeenCalledWith(
      { tenantId: 't1', rol: 'flota_admin', userId: 'u-jefe' },
      `asi_ok:${INC}`,
    );
    expect(atenderAutorizacionTalacha).not.toHaveBeenCalled();
    expect(atenderDespachoOficina).not.toHaveBeenCalled();
    expect(sendText.mock.calls.some((c) => String(c[1]).includes('RECONOCIDA'))).toBe(true);
  });

  it('el ROJO del dueño abre incidencia de flota en vez de caer al analista', async () => {
    atenderAsistenciaOficina.mockResolvedValue('REGISTRADA 🚨');
    await processInbound(texto(OFICINA_TEL, 'chocamos saliendo de la bodega'));
    expect(atenderAsistenciaOficina).toHaveBeenCalledWith(
      { tenantId: 't1', rol: 'flota_admin', userId: 'u-jefe' },
      'chocamos saliendo de la bodega',
      expect.objectContaining({ nivel: 'rojo' }),
    );
    expect(atenderDespachoOficina).not.toHaveBeenCalled();
    expect(atenderInformeOficina).not.toHaveBeenCalled();
    expect(sendText.mock.calls.some((c) => String(c[1]).includes('REGISTRADA'))).toBe(true);
  });

  it('lo que no es emergencia sigue su camino de siempre (el despacho vive)', async () => {
    atenderDespachoOficina.mockResolvedValue('DESPACHO_PROPUESTO');
    await processInbound(texto(OFICINA_TEL, 'nuevo viaje para Juan, Puebla a Monterrey, anticipo 8000'));
    expect(atenderAsistenciaOficina).not.toHaveBeenCalled();
    expect(atenderDespachoOficina).toHaveBeenCalled();
  });
});

// L-legal-01: el ROJO se evalúa ANTES que el trámite ARCO. Un mensaje que menciona «derechos ARCO» y reporta una emergencia no puede
// quedar tragado por la respuesta legal.
describe('L-legal-01 — la emergencia le gana al trámite ARCO', () => {
  it('chofer: «chocamos, hay un herido, quiero mis derechos ARCO» abre la emergencia y deja la constancia ARCO sin segundo mensaje legal', async () => {
    const conv = await import('@/lib/likida/conv');
    vi.mocked(conv.buscarOperadorPorTelefono).mockResolvedValueOnce({ tenantId: 't1', operadorId: 'o1' } as never);
    await processInbound(texto(CHOFER_TEL, 'chocamos, hay un herido, quiero ejercer mis derechos arco'));
    expect(atenderAsistenciaChofer).toHaveBeenCalledWith(expect.objectContaining({ asistencia: expect.objectContaining({ nivel: 'rojo' }) }));
    expect(registrarSolicitudArco).toHaveBeenCalledTimes(1);
    const enviados = sendText.mock.calls.map((c) => String(c[1]));
    expect(enviados.some((t) => t.includes('EMERGENCIA_ATENDIDA'))).toBe(true);
    expect(enviados.some((t) => /FLOTA SA DE CV|aviso/i.test(t))).toBe(false);
  });

  it('chofer: un ARCO sin emergencia sigue siendo ARCO (el trámite vive)', async () => {
    const conv = await import('@/lib/likida/conv');
    vi.mocked(conv.buscarOperadorPorTelefono).mockResolvedValueOnce({ tenantId: 't1', operadorId: 'o1' } as never);
    await processInbound(texto(CHOFER_TEL, 'quiero ejercer mis derechos arco'));
    expect(atenderAsistenciaChofer).not.toHaveBeenCalled();
    expect(registrarSolicitudArco).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls.some((c) => /FLOTA SA DE CV/.test(String(c[1])))).toBe(true);
  });

  it('oficina: el ROJO del dueño con «derechos ARCO» abre la incidencia de flota y registra la constancia', async () => {
    resolveOperador.mockResolvedValue(null);
    resolverCuentaOficina.mockResolvedValue(CUENTA);
    atenderAsistenciaOficina.mockResolvedValue('REGISTRADA 🚨');
    await processInbound(texto(OFICINA_TEL, 'chocamos saliendo de la bodega, y quiero mis derechos arco'));
    expect(atenderAsistenciaOficina).toHaveBeenCalled();
    expect(registrarSolicitudArco).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls.some((c) => String(c[1]).includes('REGISTRADA'))).toBe(true);
  });
});

// A37-ola9-N1: la prioridad del ROJO sobre el ARCO solo vale para quien el ROJO SÍ atiende (operador activo o cuenta de oficina). Para
// cualquier otro remitente, ARCO como siempre: la constancia (el plazo legal del art. 31) no se puede perder.
describe('N1 — ARCO + ROJO de un remitente al que el ROJO no atiende', () => {
  const MENSAJE = 'chocamos, hay un herido, quiero ejercer mis derechos arco';

  it('operador dado de baja: se registra la constancia ARCO', async () => {
    const conv = await import('@/lib/likida/conv');
    resolveOperador.mockResolvedValue(null);
    vi.mocked(conv.buscarOperadorPorTelefono).mockResolvedValueOnce({ tenantId: 't1', operadorId: 'o-baja' } as never);
    await processInbound(texto(CHOFER_TEL, MENSAJE));
    expect(registrarSolicitudArco).toHaveBeenCalledTimes(1);
    expect(atenderAsistenciaChofer).not.toHaveBeenCalled();
  });

  it('cliente del Vigía: se registra la constancia ARCO a nombre de su flota', async () => {
    resolveOperador.mockResolvedValue(null);
    contactoVigia.mockResolvedValue({ tenantId: 't1' });
    await processInbound(texto('5219990001111', MENSAJE));
    expect(registrarSolicitudArco).toHaveBeenCalledTimes(1);
  });

  it('número desconocido: la respuesta es la del trámite ARCO (no se traga el mensaje)', async () => {
    resolveOperador.mockResolvedValue(null);
    await processInbound(texto('5219990002222', MENSAJE));
    expect(sendText.mock.calls.some((c) => /No te tengo identificado/.test(String(c[1])))).toBe(true);
    expect(atenderAsistenciaChofer).not.toHaveBeenCalled();
  });

  it('operador activo: sigue ganando el ROJO y la constancia ARCO se deja (una sola vez)', async () => {
    await processInbound(texto(CHOFER_TEL, MENSAJE));
    expect(atenderAsistenciaChofer).toHaveBeenCalledTimes(1);
    expect(registrarSolicitudArco).toHaveBeenCalledTimes(1);
  });

  it('operador activo en una flota con el pipeline de WhatsApp apagado: la constancia ARCO no se pierde', async () => {
    pipelineTenantApagado.mockResolvedValue(true);
    await processInbound(texto(CHOFER_TEL, MENSAJE));
    expect(registrarSolicitudArco).toHaveBeenCalledTimes(1);
  });
});
