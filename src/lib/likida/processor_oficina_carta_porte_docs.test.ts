import { describe, it, expect, vi, beforeEach } from 'vitest';

// La oficina reenvía el documento de un cliente grande por WhatsApp: el processor lo entrega al agente de Carta Porte
// multi-formato ANTES del saludo genérico, solo a quien puede despachar, solo si es un candidato (documento, o foto
// con pie «carta porte»), y deja seguir su camino a lo que el agente no atiende.
vi.mock('@/app/api/dashboard/chat/tope', () => ({ gastoChatHoyUsd: async () => 0, topeDiaUsd: () => 5 }));
vi.mock('@/lib/likida/costos', () => ({ registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(), faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn() }));

const resolveOperador = vi.fn();
const resolverCuentaOficina = vi.fn();
const ingerir = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/likida/carta_porte_docs/whatsapp', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/carta_porte_docs/whatsapp')>()),
  ingerirDesdeWhatsapp: (...a: unknown[]) => ingerir(...a),
}));
vi.mock('./contactos', async (original) => ({ ...(await original<Record<string, unknown>>()), resolverCuentaOficina: (...a: unknown[]) => resolverCuentaOficina(...a) }));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: vi.fn(async () => null), getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })), saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null), getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true), resolverHuerfanos: vi.fn(),
  marcarHuerfanosOfrecidos: vi.fn(), addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(), getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({ razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1', urlAvisoIntegral: 'https://flota.mx/p' })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(), getViaje: vi.fn(async () => null), getOperador: vi.fn(async () => null),
  saveLiquidacion: vi.fn(async () => 'L1'), getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
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
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const JEFE = { userId: 'u1', tenantId: 't1', rol: 'flota_admin', nombre: 'Rodrigo', email: 'r@flota.mx' };
const documento = (extra: Record<string, unknown> = {}) => ({ from: '5215550000001', type: 'document' as const, mediaId: 'media-1', waMessageId: 'wa-doc-1', ...extra });

describe('processInbound — la oficina reenvía un documento de cliente', () => {
  beforeEach(() => {
    salientes.length = 0;
    resolveOperador.mockResolvedValue(null);
    resolverCuentaOficina.mockResolvedValue(JEFE);
    ingerir.mockReset().mockResolvedValue('atendido');
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('un documento del jefe va al agente de Carta Porte con SU flota y SU usuario, y no sale el saludo genérico', async () => {
    await processInbound(documento());
    expect(ingerir).toHaveBeenCalledTimes(1);
    const [entrada, deps] = ingerir.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(entrada).toMatchObject({ tenantId: 't1', userId: 'u1', nombreRemitente: 'Rodrigo', mensaje: expect.objectContaining({ type: 'document', mediaId: 'media-1' }) });
    expect(String(entrada.urlBandeja)).toMatch(/\/dashboard\/carta-porte\/documentos$/);
    for (const f of ['metadatos', 'descargar', 'responder', 'restanteMs', 'senal']) expect(typeof deps[f], f).toBe('function');
    expect(salientes.join(' ')).not.toMatch(/te reconozco como/);
  });

  it('si el agente dice «no aplica» (p. ej. un XML de proveedor), el mensaje sigue su camino de siempre', async () => {
    ingerir.mockResolvedValue('no_aplica');
    await processInbound(documento());
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(salientes.join(' ')).toMatch(/te reconozco como parte del equipo/);
  });

  it('el CONTADOR (que no despacha) no entra al agente', async () => {
    resolverCuentaOficina.mockResolvedValue({ ...JEFE, rol: 'contador' });
    await processInbound(documento());
    expect(ingerir).not.toHaveBeenCalled();
    expect(salientes.join(' ')).toMatch(/te reconozco como contador/);
  });

  it('una foto SIN pie de carta porte no es un candidato; con pie, sí', async () => {
    await processInbound({ from: '5215550000001', type: 'image' as const, mediaId: 'm2', text: 'ticket de la gasolinera', waMessageId: 'wa-img-1' });
    expect(ingerir).not.toHaveBeenCalled();
    await processInbound({ from: '5215550000001', type: 'image' as const, mediaId: 'm3', text: 'Carta porte del embarque 5521', waMessageId: 'wa-img-2' });
    expect(ingerir).toHaveBeenCalledTimes(1);
  });

  it('un texto no toca al agente', async () => {
    await processInbound({ from: '5215550000001', type: 'text' as const, text: 'hola', waMessageId: 'wa-txt-1' });
    expect(ingerir).not.toHaveBeenCalled();
  });

  it('un usuario sin flota (superadmin) no entra', async () => {
    resolverCuentaOficina.mockResolvedValue({ ...JEFE, rol: 'superadmin', tenantId: null });
    await processInbound(documento({ waMessageId: 'wa-doc-sa' }));
    expect(ingerir).not.toHaveBeenCalled();
  });
});
