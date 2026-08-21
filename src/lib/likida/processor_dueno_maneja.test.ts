import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL DUEÑO QUE MANEJA — un número que es chofer Y oficina a la vez.
//
// `contactos.ts` documenta desde la 0059 que en una flota chica el dueño maneja
// y que por eso se devuelven LAS DOS caras, "y quien llama decide con su propio
// contexto". El dispatcher no decidía: `resolveOperador` acertaba y el camino de
// oficina no se probaba siquiera, así que dar de alta al dueño como operador
// —para que pudiera mandar sus tickets— le apagaba en silencio el despacho y los
// informes por WhatsApp.
//
// Lo que se fija aquí es el reparto: el mando de oficina viaja SOLO en texto, el
// analista NO se pone delante del chofer, y un choque de tenants no se adivina.
// ═══════════════════════════════════════════════════════════════════════════

const resolveOperador = vi.fn();
const resolverCuentaOficina = vi.fn();
const getOpenViaje = vi.fn();
const atenderDespachoOficina = vi.fn();
const atenderInformeOficina = vi.fn();
const atenderPreguntaLibre = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/likida/despacho_wa', () => ({
  atenderDespachoOficina: (...a: unknown[]) => atenderDespachoOficina(...a),
}));
vi.mock('@/lib/likida/informes_wa', () => ({
  atenderInformeOficina: (...a: unknown[]) => atenderInformeOficina(...a),
}));
vi.mock('@/lib/likida/oficina_wa', () => ({
  pideInformePdf: () => false,
  mandarInformePdf: vi.fn(),
  atenderPreguntaLibre: (...a: unknown[]) => atenderPreguntaLibre(...a),
}));
vi.mock('./contactos', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolverCuentaOficina: (...a: unknown[]) => resolverCuentaOficina(...a),
  telefonoJefeDe: vi.fn(async () => null),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: (...a: unknown[]) => getOpenViaje(...a),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
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
  getViaje: vi.fn(async () => null),
  getOperador: vi.fn(async () => null),
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
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

const TEL = '529993700779';
/** El dueño: la misma persona es el operador del viaje y el admin de la flota. */
const COMO_CHOFER = { tenantId: 't1', operadorId: 'op1', nombre: 'Javier' };
const COMO_OFICINA = { userId: 'u1', tenantId: 't1', rol: 'flota_admin', nombre: 'Javier', email: 'j@flota.mx' };

let n = 0;
function msg(text: string) {
  return { from: TEL, type: 'text' as const, text, waMessageId: `wa-${n++}` };
}

describe('processInbound — el dueño que maneja es chofer Y oficina', () => {
  beforeEach(() => {
    salientes.length = 0;
    n = 0;
    resolveOperador.mockResolvedValue(COMO_CHOFER); // SÍ es chofer
    resolverCuentaOficina.mockResolvedValue(COMO_OFICINA); // y también oficina
    getOpenViaje.mockReset().mockResolvedValue('v1'); // en ruta, salvo donde se diga
    atenderDespachoOficina.mockReset().mockResolvedValue(null);
    atenderInformeOficina.mockReset().mockResolvedValue(null);
    atenderPreguntaLibre.mockReset().mockResolvedValue('el analista contestó');
    logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('SIN viaje propio abierto, despacha aunque el número sea operador', async () => {
    getOpenViaje.mockResolvedValue(null); // el dueño no trae viaje propio: puede despachar
    atenderDespachoOficina.mockResolvedValue('Voy a crear este viaje: …');
    await processInbound(msg('nuevo viaje para Juan, Puebla a Monterrey'));

    expect(atenderDespachoOficina).toHaveBeenCalledWith(
      { tenantId: 't1', rol: 'flota_admin' }, TEL, 'nuevo viaje para Juan, Puebla a Monterrey',
    );
    expect(salientes[0]).toContain('Voy a crear este viaje');
  });

  // ── AUDITORÍA 1, CRÍTICO (Agéntico) ──────────────────────────────────────
  it('CON VIAJE ABIERTO no se despacha: el «va» del chofer no confirma un viaje ajeno', async () => {
    // getOpenViaje devuelve 'v1' por defecto. Un «va» soltado en ruta —muletilla,
    // o respuesta a otra cosa— NO debe llegar a despacho_wa (donde esAfirmacion
    // lo tomaría como "sí" y crearía un viaje con anticipo real).
    atenderDespachoOficina.mockResolvedValue('NO DEBERÍA CREAR NADA');
    await processInbound(msg('va'));
    expect(atenderDespachoOficina).not.toHaveBeenCalled();
    expect(salientes.join('\n')).not.toContain('NO DEBERÍA CREAR NADA');
  });

  it('CON VIAJE ABIERTO tampoco se despacha un «nuevo viaje…»: primero cierra el suyo', async () => {
    atenderDespachoOficina.mockResolvedValue('no debería');
    await processInbound(msg('nuevo viaje para Juan, Puebla a Monterrey'));
    expect(atenderDespachoOficina).not.toHaveBeenCalled();
  });

  it('«¿cómo van?» le contesta el informe, no el camino del chofer', async () => {
    atenderInformeOficina.mockResolvedValue('Llevas 3 viajes abiertos.');
    await processInbound(msg('¿cómo van?'));

    expect(salientes[0]).toContain('Llevas 3 viajes abiertos');
  });

  it('CON VIAJE ABIERTO el analista no se pone delante del chofer: «listo» no se lo come', async () => {
    // El analista contesta cualquier cosa. Si entrara aquí, se quedaría con el
    // texto con el que un chofer CIERRA su viaje.
    await processInbound(msg('listo'));

    expect(atenderPreguntaLibre).not.toHaveBeenCalled();
    expect(salientes.join('\n')).not.toContain('el analista contestó');
  });

  it('SIN viaje abierto la pregunta suelta sí llega al analista: ya no hay ruta que disputar', async () => {
    getOpenViaje.mockResolvedValue(null);
    await processInbound(msg('¿cuánto llevo gastado en diésel este mes?'));

    expect(atenderPreguntaLibre).toHaveBeenCalled();
    expect(salientes[0]).toContain('el analista contestó');
  });

  it('una FOTO nunca se le ofrece a oficina: es de ruta por definición', async () => {
    await processInbound({ from: TEL, type: 'image', mediaId: 'm1', waMessageId: 'wa-img' });

    expect(atenderDespachoOficina).not.toHaveBeenCalled();
    expect(atenderInformeOficina).not.toHaveBeenCalled();
  });

  it('cuenta de oficina en OTRA flota: no se adivina, se anota y sigue como chofer', async () => {
    resolverCuentaOficina.mockResolvedValue({ ...COMO_OFICINA, tenantId: 't-OTRO' });
    atenderDespachoOficina.mockResolvedValue('no debería llegar aquí');
    await processInbound(msg('nuevo viaje para Juan'));

    expect(atenderDespachoOficina).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('chofer.oficina_otro_tenant', expect.objectContaining({
      operadorTenant: 't1', cuentaTenant: 't-OTRO',
    }));
  });

  it('si la cuenta de oficina no se puede resolver, sigue como chofer sin tumbar el mensaje', async () => {
    resolverCuentaOficina.mockRejectedValue(new Error('base caída'));
    await processInbound(msg('nuevo viaje para Juan'));

    expect(atenderDespachoOficina).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('chofer.oficina_no_resuelta', expect.anything());
  });
});
