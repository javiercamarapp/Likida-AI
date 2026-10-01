import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CABLEADO DEL VIGÍA EN EL PROCESSOR (Agente 4, 0400).
//
// La lógica del Vigía se prueba en `vigia/*.test.ts`; esto fija SOLO el orden del
// dispatcher:
//   · un número que no es chofer, oficina ni proveedor se ofrece al Vigía ANTES de
//     decirle «no te tengo registrado»; si no es un cliente autorizado, recibe esa
//     frase de siempre (la regla se conserva);
//   · un cliente atendido NO recibe «no te tengo registrado»;
//   · si el Vigía pide reintento, se suelta el claim y no se contesta nada;
//   · si el Vigía revienta, el desconocido recibe su respuesta de siempre;
//   · un chofer NUNCA pasa por el Vigía;
//   · los botones `vig_*` de la oficina llegan al Vigía con el tenant y el rol de la CUENTA.
// ═══════════════════════════════════════════════════════════════════════════

const resolveOperador = vi.fn();
const resolverCuentaOficina = vi.fn();
const aceptarPorActividad = vi.fn();
const enviarBriefingInicio = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const decidirFoto = vi.fn();
const addGasto = vi.fn();
const intakeDelta = vi.fn();
const sendText = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
const anclarUbicacionIncidencia = vi.fn();
vi.mock('@/lib/likida/asistencia_wa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  anclarUbicacionIncidencia: (...a: unknown[]) => anclarUbicacionIncidencia(...a),
}));
const atenderMedioProveedorSinTexto = vi.fn();
const atenderMensajeProveedor = vi.fn();
vi.mock('@/lib/likida/asistencia_coordinacion', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  atenderMensajeProveedor: (...a: unknown[]) => atenderMensajeProveedor(...a),
  atenderMedioProveedorSinTexto: (...a: unknown[]) => atenderMedioProveedorSinTexto(...a),
}));
vi.mock('@/lib/likida/briefing_inicio_wa', () => ({
  enviarBriefingInicio: (...a: unknown[]) => enviarBriefingInicio(...a),
}));
vi.mock('@/lib/likida/confirmar_viaje', () => ({
  atenderConfirmacion: vi.fn(async () => ({ mensaje: null, estado: 'nada' })),
  aceptarPorActividad: (...a: unknown[]) => aceptarPorActividad(...a),
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
  liberarEnvioAviso: vi.fn(), registrarSolicitudArco: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', () => ({
  MAX_CUERPO_BOTONES: 1024,
  sendText: (...a: unknown[]) => sendText(...a),
  // AGEN-5: el aviso al jefe sale por `avisarOficina` (texto → plantilla).
  enviarTexto: vi.fn(async () => ({ ok: true, id: 'wamid.JEFE' })),
  sendTemplate: vi.fn(async () => ({ ok: true, id: 'wamid.PLANTILLA' })),
  motivoDeFalloWhatsApp: (e: string) => e,
  sendButtons: vi.fn(async () => 'wamid.BTN'),
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
vi.mock('@/lib/logger', () => ({ logger }));


const atenderMensajeCliente = vi.fn();
const atenderDecisionVigia = vi.fn();
vi.mock('./vigia/servicio', () => ({
  atenderMensajeCliente: (...a: unknown[]) => atenderMensajeCliente(...a),
  atenderDecisionVigia: (...a: unknown[]) => atenderDecisionVigia(...a),
}));
vi.mock('./vigia/deps', () => ({ crearDepsVigia: () => ({ repo: 'repo-falso' }) }));
vi.mock('./vigia/repo', () => ({ crearRepoVigia: () => ({ contactoPorTelefono: async () => null }) }));

const { processInbound } = await import('./processor');

const DESCONOCIDO = '5215500000099';
const GERENTE = '5215500000011';
let n = 0;
const texto = (from: string, t: string) => ({ from, type: 'text' as const, text: t, waMessageId: `wa-v-${n++}` });
const respuestas = () => sendText.mock.calls.map((c) => String(c[1]));

beforeEach(() => {
  vi.clearAllMocks();
  resolveOperador.mockResolvedValue(null);
  resolverCuentaOficina.mockResolvedValue(null);
  sendText.mockResolvedValue('wamid.TXT');
  atenderMensajeProveedor.mockResolvedValue(null);
  atenderMedioProveedorSinTexto.mockResolvedValue(null);
  atenderMensajeCliente.mockResolvedValue('no_es_cliente');
  atenderDecisionVigia.mockResolvedValue(null);
});

describe('un número que no es chofer, oficina ni proveedor', () => {
  it('no es cliente autorizado: se conserva «no te tengo registrado»', async () => {
    await processInbound(texto(DESCONOCIDO, 'hola'));
    expect(atenderMensajeCliente).toHaveBeenCalledTimes(1);
    expect(atenderMensajeCliente.mock.calls[0][0]).toMatchObject({ from: DESCONOCIDO, type: 'text', text: 'hola' });
    expect(respuestas().some((t) => t.includes('no te tengo registrado'))).toBe(true);
  });

  it('cliente atendido por el Vigía: NO recibe «no te tengo registrado» y el processor no le contesta nada propio', async () => {
    atenderMensajeCliente.mockResolvedValue('atendido');
    await processInbound(texto(DESCONOCIDO, '¿dónde va mi viaje?'));
    expect(respuestas()).toEqual([]);
  });

  it('el Vigía pide reintento: se suelta el claim y no se contesta nada (ni «no te tengo registrado»)', async () => {
    atenderMensajeCliente.mockResolvedValue('reintentar');
    const r = await processInbound(texto(DESCONOCIDO, 'hola'));
    expect(respuestas()).toEqual([]);
    expect(r).toBe('reintentable');
  });

  it('el Vigía revienta: el desconocido recibe su respuesta de siempre (el Vigía no puede dejarlo mudo)', async () => {
    atenderMensajeCliente.mockRejectedValue(new Error('0400 sin aplicar'));
    await processInbound(texto(DESCONOCIDO, 'hola'));
    expect(respuestas().some((t) => t.includes('no te tengo registrado'))).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('vigia.mensaje_error', expect.any(Object));
  });

  it('un proveedor con gestión viva sigue ganando: el Vigía ni se entera', async () => {
    atenderMensajeProveedor.mockResolvedValue('Gracias, 40 min y $1,200 anotado');
    await processInbound(texto(DESCONOCIDO, '40 min $1200'));
    expect(atenderMensajeCliente).not.toHaveBeenCalled();
  });

  it('una foto o un audio de un cliente también llegan al Vigía (él decide qué hacer)', async () => {
    atenderMensajeCliente.mockResolvedValue('atendido');
    await processInbound({ from: DESCONOCIDO, type: 'image', mediaId: 'm1', waMessageId: `wa-v-${n++}` });
    expect(atenderMensajeCliente.mock.calls[0][0]).toMatchObject({ type: 'image' });
    expect(respuestas()).toEqual([]);
  });
});

describe('un chofer nunca pasa por el Vigía', () => {
  it('con operador resuelto no se consulta al Vigía', async () => {
    resolveOperador.mockResolvedValue({ tenantId: 't1', operadorId: 'o1', nombre: 'Juan' });
    await processInbound(texto(DESCONOCIDO, 'hola'));
    expect(atenderMensajeCliente).not.toHaveBeenCalled();
  });
});

describe('los botones del gerente (oficina)', () => {
  const CUENTA = { userId: 'u1', tenantId: 't1', rol: 'encargado', nombre: 'Luis', email: 'l@x.mx' };

  it('vig_ok llega al Vigía con el tenant y el rol de la CUENTA, y su respuesta sale por WhatsApp', async () => {
    resolverCuentaOficina.mockResolvedValue(CUENTA);
    atenderDecisionVigia.mockResolvedValue('Listo, se envió la respuesta a María.');
    const boton = 'vig_ok:12345678-1234-4234-8234-123456789abc';
    await processInbound(texto(GERENTE, boton));
    expect(atenderDecisionVigia).toHaveBeenCalledWith({ tenantId: 't1', rol: 'encargado', userId: 'u1' }, boton, expect.anything());
    expect(sendText).toHaveBeenCalledWith(GERENTE, 'Listo, se envió la respuesta a María.');
    expect(atenderMensajeCliente).not.toHaveBeenCalled();
  });

  it('un texto que no es un botón del Vigía (null) sigue su camino normal de oficina', async () => {
    resolverCuentaOficina.mockResolvedValue(CUENTA);
    await processInbound(texto(GERENTE, 'hola, ¿cómo van?'));
    expect(atenderDecisionVigia).toHaveBeenCalledTimes(1);
    expect(respuestas().every((t) => !t.includes('Listo, se envió'))).toBe(true);
  });

  it('si el Vigía revienta al decidir, la oficina no se queda sin su respuesta de siempre', async () => {
    resolverCuentaOficina.mockResolvedValue(CUENTA);
    atenderDecisionVigia.mockRejectedValue(new Error('boom'));
    await processInbound(texto(GERENTE, 'vig_ok:12345678-1234-4234-8234-123456789abc'));
    expect(logger.error).toHaveBeenCalledWith('oficina.vigia_error', expect.any(Object));
  });
});
