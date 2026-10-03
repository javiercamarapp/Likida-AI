import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El CABLEADO de «¿por dónde entro?» (convenios, 0580) en el dispatcher: la pregunta del operador se responde con el
// perfil del convenio ANTES del Conductor y del agente, y lo que no es de ese módulo sigue su camino.
// El módulo tiene sus propias pruebas (convenios/pregunta.test.ts); aquí se prueba el CABLEADO.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const resolveOperador = vi.fn();
const atenderConductor = vi.fn();
const atenderPreguntaConvenio = vi.fn();
const atenderAcuseJefe = vi.fn();
const atenderPinConductor = vi.fn();
const hitoParaEvidenciaDelChofer = vi.fn();
const registrarEvidenciaDelChofer = vi.fn();
const registrarHitoDesdeFoto = vi.fn();
const subirComprobante = vi.fn();
const enviarSolicitudUbicacion = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
// El motor de hitos (conductor/atender.ts) tiene sus propias pruebas con una base en
// memoria (atender.test.ts); AQUÍ se prueba el CABLEADO en el dispatcher.
vi.mock('@/lib/likida/conductor/atender', () => ({
  atenderConductor: (...a: unknown[]) => atenderConductor(...a),
  atenderAcuseJefe: (...a: unknown[]) => atenderAcuseJefe(...a),
  atenderPinConductor: (...a: unknown[]) => atenderPinConductor(...a),
  hitoParaEvidenciaDelChofer: (...a: unknown[]) => hitoParaEvidenciaDelChofer(...a),
  registrarEvidenciaDelChofer: (...a: unknown[]) => registrarEvidenciaDelChofer(...a),
  registrarHitoDesdeFoto: (...a: unknown[]) => registrarHitoDesdeFoto(...a),
}));
vi.mock('@/lib/likida/convenios/pregunta', () => ({ atenderPreguntaConvenio: (...a: unknown[]) => atenderPreguntaConvenio(...a) }));
vi.mock('@/lib/likida/intake/almacen', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
}));
const FOTO_DE_PRUEBA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////';
const descargarMedia = vi.fn(async (..._a: unknown[]): Promise<string | null> => FOTO_DE_PRUEBA);
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarSolicitudUbicacion: (...a: unknown[]) => enviarSolicitudUbicacion(...a),
  downloadMediaAsDataUrl: (...a: unknown[]) => descargarMedia(...a),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  viajeAbiertoDesdeMs: vi.fn(async () => null),
  fotoAnteriorSinProcesar: vi.fn(async () => ({ vivas: 0, muertas: [] })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
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
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/likida/costos', () => ({
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
const envioPorDefecto = async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};
const fetchSpy = vi.fn(envioPorDefecto);

function msg(text: string, timestampMs?: number) {
  return { from: '5219993700779', type: 'text' as const, text, waMessageId: `wa-${text.slice(0, 8)}`, timestampMs };
}

describe('processInbound — las instrucciones del convenio, cableadas', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); resolveOperador.mockReset(); atenderConductor.mockReset(); atenderAcuseJefe.mockReset(); atenderPreguntaConvenio.mockReset();
    atenderPinConductor.mockReset(); hitoParaEvidenciaDelChofer.mockReset(); registrarEvidenciaDelChofer.mockReset(); registrarHitoDesdeFoto.mockReset(); subirComprobante.mockReset(); enviarSolicitudUbicacion.mockReset(); descargarMedia.mockClear();
    atenderPinConductor.mockResolvedValue(null); hitoParaEvidenciaDelChofer.mockResolvedValue(null); enviarSolicitudUbicacion.mockResolvedValue({ ok: true });
    resolveOperador.mockResolvedValue({ tenantId: 't1', operadorId: 'o1' });
    atenderConductor.mockResolvedValue(null);
    atenderAcuseJefe.mockResolvedValue(null);
    atenderPreguntaConvenio.mockResolvedValue(null);
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(envioPorDefecto);
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('«¿por dónde entro?» se responde con el perfil del convenio, con el contexto del chofer, y NO llega al Conductor ni al agente', async () => {
    atenderPreguntaConvenio.mockResolvedValue('• Por dónde entras: Puerta 3, lado poniente');
    await processInbound(msg('¿por dónde entro?'));
    expect(atenderPreguntaConvenio).toHaveBeenCalledTimes(1);
    expect(atenderPreguntaConvenio.mock.calls[0][0]).toEqual({ tenantId: 't1', operadorId: 'o1', viajeAbiertoId: 'v1', texto: '¿por dónde entro?' });
    expect(salientes).toEqual(['• Por dónde entras: Puerta 3, lado poniente']);
    expect(atenderConductor).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('lo que el módulo no reclama (null) sigue su camino al Conductor', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅' }] });
    await processInbound(msg('ya llegué'));
    expect(atenderPreguntaConvenio).toHaveBeenCalledTimes(1);
    expect(atenderConductor).toHaveBeenCalledTimes(1);
    expect(salientes).toEqual(['Anotado ✅']);
  });
});
