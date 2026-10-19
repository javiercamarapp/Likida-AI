import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// PERFIL `cinco_agentes`: el Conductor (A5) se encendió el 18-oct-2026 (salió de
// `MODULOS_PROXIMAMENTE_PERFIL`). El WhatsApp del chofer SÍ registra hitos, SÍ pide
// ubicación y SÍ avisa a nombre del módulo, igual que sin perfil.
// Si el perfil no se puede leer, falla cerrado en `perfilDeTenant` (otras pruebas lo cubren);
// aquí solo importa que, con perfil legible, el Conductor opera.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const resolveOperador = vi.fn();
const atenderConductor = vi.fn();
const atenderAcuseJefe = vi.fn();
const atenderPinConductor = vi.fn();
const hitoParaEvidenciaDelChofer = vi.fn();
const registrarEvidenciaDelChofer = vi.fn();
const registrarHitoDesdeFoto = vi.fn();
const subirComprobante = vi.fn();
const enviarSolicitudUbicacion = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
// Lo que contesta la tabla `tenant_perfil`: un perfil, `null` (sin fila) o un error de lectura.
let tablaPerfil: { data: { perfil: string } | null; error: { message: string; code?: string } | null } = { data: null, error: null };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/conductor/atender', () => ({
  atenderConductor: (...a: unknown[]) => atenderConductor(...a),
  atenderAcuseJefe: (...a: unknown[]) => atenderAcuseJefe(...a),
  atenderPinConductor: (...a: unknown[]) => atenderPinConductor(...a),
  hitoParaEvidenciaDelChofer: (...a: unknown[]) => hitoParaEvidenciaDelChofer(...a),
  registrarEvidenciaDelChofer: (...a: unknown[]) => registrarEvidenciaDelChofer(...a),
  registrarHitoDesdeFoto: (...a: unknown[]) => registrarHitoDesdeFoto(...a),
}));
vi.mock('@/lib/likida/intake/almacen', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
}));
const FOTO_DE_PRUEBA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////';
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarSolicitudUbicacion: (...a: unknown[]) => enviarSolicitudUbicacion(...a),
  downloadMediaAsDataUrl: vi.fn(async () => FOTO_DE_PRUEBA),
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
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.example/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219990000001' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => tablaPerfil }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');
const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const CHOFER = '5219990000001';
let n = 0;
const texto = (t: string) => ({ from: CHOFER, type: 'text' as const, text: t, waMessageId: `wa-sb-${n++}` });
const pin = () => ({ from: CHOFER, type: 'location' as const, lat: 20.97, lng: -89.62, waMessageId: `wa-sb-${n++}` });

describe('processInbound — el Conductor (A5) ya encendido bajo el perfil cinco_agentes', () => {
  beforeEach(() => {
    salientes.length = 0;
    vi.clearAllMocks();
    reiniciarCachePerfil();
    tablaPerfil = { data: { perfil: 'cinco_agentes' }, error: null };
    runAgent.mockResolvedValue({ text: 'ok', toolCalls: [] });
    resolveOperador.mockResolvedValue({ tenantId: 't1', operadorId: 'o1' });
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅' }], solicitarUbicacion: { viajeId: 'v1' } });
    atenderPinConductor.mockResolvedValue('linea del conductor');
    hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'sello', hito: { id: 'h1' }, comoHito: null });
    enviarSolicitudUbicacion.mockResolvedValue({ ok: true });
    atenderAcuseJefe.mockResolvedValue(null);
    vi.stubGlobal('fetch', fetchSpy);
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('«llegué a la carga» con perfil: el Conductor se invoca y manda su mensaje, igual que sin perfil', async () => {
    await processInbound(texto('llegué a la carga'));
    expect(atenderConductor).toHaveBeenCalledTimes(1);
    expect(salientes).toContain('Anotado ✅');
  });

  it('el pin de ubicación con perfil: el Conductor lo adjunta y lo compara', async () => {
    await processInbound(pin());
    expect(atenderPinConductor).toHaveBeenCalledTimes(1);
    expect(salientes.some((s) => s.includes('linea del conductor'))).toBe(true);
  });

  it('SIN fila de perfil nada cambia: el Conductor atiende como siempre', async () => {
    tablaPerfil = { data: null, error: null };
    await processInbound(texto('llegué a la carga'));
    expect(atenderConductor).toHaveBeenCalledTimes(1);
    expect(salientes).toContain('Anotado ✅');
    expect(enviarSolicitudUbicacion).toHaveBeenCalledTimes(1);
  });

  it('si el perfil no se puede leer, el Conductor sigue operando (ya no es «Próximamente»: no depende de poder leer el perfil)', async () => {
    tablaPerfil = { data: null, error: { message: 'timeout' } };
    await processInbound(texto('llegué a la carga'));
    expect(atenderConductor).toHaveBeenCalledTimes(1);
    expect(salientes).toContain('Anotado ✅');
  });
});
