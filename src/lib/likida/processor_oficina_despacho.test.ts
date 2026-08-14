import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// La rama de OFICINA del dispatcher (processor.ts ~402-470) no tenía NINGUNA
// prueba — lo anotó el mapa del 14-ago. Aquí se fija el contrato nuevo de F4:
// el texto del jefe pasa primero por despacho_wa; si el módulo contesta, eso
// se manda; si devuelve null o truena, cae al saludo de siempre — y el saludo
// solo PROMETE despachar a quien su rol se lo permite.
// ═══════════════════════════════════════════════════════════════════════════

const resolveOperador = vi.fn();
const resolverCuentaOficina = vi.fn();
const atenderDespachoOficina = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/likida/despacho_wa', () => ({
  atenderDespachoOficina: (...a: unknown[]) => atenderDespachoOficina(...a),
}));
vi.mock('./contactos', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolverCuentaOficina: (...a: unknown[]) => resolverCuentaOficina(...a),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: vi.fn(async () => null),
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

const JEFE = { userId: 'u1', tenantId: 't1', rol: 'flota_admin', nombre: 'Rodrigo', email: 'r@flota.mx' };

function msg(text: string) {
  return { from: '5215550000001', type: 'text' as const, text, waMessageId: `wa-${text.slice(0, 10)}` };
}

describe('processInbound — la rama de oficina despacha', () => {
  beforeEach(() => {
    salientes.length = 0;
    resolveOperador.mockResolvedValue(null); // no es chofer
    resolverCuentaOficina.mockResolvedValue(JEFE);
    atenderDespachoOficina.mockReset();
    logger.error.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('el texto del jefe pasa por despacho_wa y su respuesta es la que sale', async () => {
    atenderDespachoOficina.mockResolvedValue('Voy a crear este viaje: …');
    await processInbound(msg('nuevo viaje para Juan, Puebla a Monterrey'));

    expect(atenderDespachoOficina).toHaveBeenCalledWith(
      { tenantId: 't1', rol: 'flota_admin' },
      '5215550000001',
      'nuevo viaje para Juan, Puebla a Monterrey',
    );
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toContain('Voy a crear este viaje');
  });

  it('si el módulo devuelve null, cae al saludo — que al jefe SÍ le promete despachar', async () => {
    atenderDespachoOficina.mockResolvedValue(null);
    await processInbound(msg('hola'));

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/te reconozco como parte del equipo/);
    expect(salientes[0]).toMatch(/despacharme viajes/);
  });

  it('al CONTADOR el saludo no le promete lo que puedeAsignar le va a negar', async () => {
    resolverCuentaOficina.mockResolvedValue({ ...JEFE, rol: 'contador' });
    atenderDespachoOficina.mockResolvedValue(null);
    await processInbound(msg('hola'));

    expect(salientes[0]).toMatch(/te reconozco como contador/);
    expect(salientes[0]).not.toMatch(/despacharme viajes/);
  });

  it('si despacho_wa truena, el jefe NO se queda sin respuesta: cae al saludo', async () => {
    atenderDespachoOficina.mockRejectedValue(new Error('se cayó'));
    await processInbound(msg('nuevo viaje para Juan, Puebla a Monterrey'));

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/te reconozco/);
    expect(logger.error).toHaveBeenCalledWith('oficina.despacho_error', expect.anything());
  });
});
