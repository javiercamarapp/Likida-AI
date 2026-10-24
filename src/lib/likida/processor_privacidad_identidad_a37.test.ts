import { describe, it, expect, vi, beforeEach } from 'vitest';

const gastoHoyUsd = 0;
vi.mock('@/app/api/dashboard/chat/tope', () => ({
  gastoChatHoyUsd: async () => gastoHoyUsd,
  topeDiaUsd: () => 5,
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: async () => {},
  faseDeModelo: () => 'chat',
}));

// ═══════════════════════════════════════════════════════════════════════════
// El CABLEADO de F4 en el dispatcher — lo que las unidades no pueden probar:
//
//   · el caption "carta porte" saca la foto del camino de comprobantes (ni
//     visión ni gasto ni barrera) y la manda al POD;
//   · el caption de talacha deja que el gasto ENTRE por el camino normal y
//     después abre la solicitud con el gasto y la evidencia enlazados;
//   · en la oficina, la decisión de talacha corre ANTES que el despacho, y
//     el informe DESPUÉS — el orden es el contrato;
//   · el número desconocido sigue recibiendo su "no te tengo registrado".
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const buscarOperador = vi.fn();
const contactoVigia = vi.fn();
const claimLiberado = vi.fn();
const resolveOperador = vi.fn();
const resolverCuentaOficina = vi.fn();
const atenderTalachaChofer = vi.fn();
const atenderAutorizacionTalacha = vi.fn();
const atenderDespachoOficina = vi.fn();
const atenderAsignacionOficina = vi.fn();
const atenderInformeOficina = vi.fn();
const guardarPodDelChofer = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const decidirFoto = vi.fn();
const addGasto = vi.fn();
const intakeDelta = vi.fn();
const sendText = vi.fn();
const sendButtons = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/talacha_wa', async (original) => ({
  // El matcher es el REAL: lo mockeado es el efecto (DB + jefe).
  ...(await original<Record<string, unknown>>()),
  atenderTalachaChofer: (...a: unknown[]) => atenderTalachaChofer(...a),
  atenderAutorizacionTalacha: (...a: unknown[]) => atenderAutorizacionTalacha(...a),
}));
vi.mock('@/lib/likida/pod_wa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  guardarPodDelChofer: (...a: unknown[]) => guardarPodDelChofer(...a),
}));
vi.mock('@/lib/likida/despacho_wa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  atenderDespachoOficina: (...a: unknown[]) => atenderDespachoOficina(...a),
}));
vi.mock('@/lib/likida/asignar_wa', () => ({
  atenderAsignacionOficina: (...a: unknown[]) => atenderAsignacionOficina(...a),
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
  buscarOperadorPorTelefono: (...a: unknown[]) => buscarOperador(...a),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: (...a: unknown[]) => claimLiberado(...a),
  intakeDelta: (...a: unknown[]) => intakeDelta(...a),
  esperarIntake: vi.fn(async () => true),
  buscarTenantPorTelefono: vi.fn(async () => null),
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
vi.mock('@/lib/logger', () => ({ logger }));

vi.mock('./vigia/repo', () => ({ crearRepoVigia: () => ({ contactoPorTelefono: (...a: unknown[]) => contactoVigia(...a) }) }));

const { processInbound } = await import('./processor');

// A37-S55-05: la búsqueda de identidad del medio ARCO distingue «no existe» de «no pude consultar».
const TEL = '5219990000001';
const privacidad = () => ({ from: TEL, type: 'text' as const, text: 'PRIVACIDAD quiero cancelar mis datos', waMessageId: `wa-priv-${Math.random()}` });
const dicho = () => sendText.mock.calls.map((c) => String(c[1])).join(' | ');

beforeEach(() => {
  vi.clearAllMocks();
  resolveOperador.mockResolvedValue(null);
  resolverCuentaOficina.mockResolvedValue(null);
  buscarOperador.mockResolvedValue(null);
  contactoVigia.mockResolvedValue(null);
  sendText.mockResolvedValue('wamid.TXT');
});

describe('A37-S55-05 — ARCO: un fallo de consulta no se disfraza de «no te tengo identificado»', () => {
  it('base caída en TODAS las búsquedas: no afirma «no te tengo identificado», avisa del reintento y SUELTA el claim', async () => {
    buscarOperador.mockRejectedValue(new Error('timeout'));
    resolverCuentaOficina.mockRejectedValue(new Error('timeout'));
    contactoVigia.mockRejectedValue(new Error('timeout'));
    await processInbound(privacidad());
    expect(dicho()).not.toMatch(/no te tengo identificado/i);
    expect(dicho()).toMatch(/vuelvo a intentar/i);
    expect(claimLiberado).toHaveBeenCalled();
  });

  it('control: de verdad no existe en ninguna parte (sin errores) → sí dice que no lo tiene identificado', async () => {
    await processInbound(privacidad());
    expect(dicho()).toMatch(/no te tengo identificado/i);
    expect(claimLiberado).not.toHaveBeenCalled();
  });

  it('control: una búsqueda falla pero otra identifica al titular → se atiende, no se reintenta', async () => {
    buscarOperador.mockRejectedValue(new Error('timeout'));
    resolverCuentaOficina.mockResolvedValue(null);
    contactoVigia.mockResolvedValue({ tenantId: 't1' });
    await processInbound(privacidad());
    expect(dicho()).not.toMatch(/vuelvo a intentar/i);
    expect(dicho()).not.toMatch(/no te tengo identificado/i);
  });
});
