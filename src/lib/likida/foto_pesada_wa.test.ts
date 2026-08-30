import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21, MEDIO — el chofer que manda una foto demasiado pesada.
//
// `downloadMediaAsDataUrl` ahora lanza `ImagenDemasiadoPesadaError` cuando la
// foto excede `MAX_IMAGEN_WHATSAPP_BYTES` (ver `meta/imagen_pesada.test.ts`
// para las pruebas de esa capa). Esta prueba ejercita `processInbound` de
// verdad: lo que importa es que el chofer reciba el mensaje CORRECTO —"tu
// foto es muy pesada, mándala de nuevo o comprimida"— y no el genérico "no
// pude descargar tu foto" (que le sugeriría reenviar la MISMA foto, que va a
// fallar exactamente igual), y que una foto normal siga procesándose sin
// tocarse.
//
// El camino ejercitado es el de "sin viaje abierto" (el mismo que
// `huerfanos_flujo.test.ts`): es el que tiene menos mocks alrededor del
// `downloadMediaAsDataUrl` y el más simple para aislar el comportamiento
// nuevo.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const guardarHuerfano = vi.fn();
const getHuerfanos = vi.fn();
const getOpenViaje = vi.fn();
const getGastos = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const runAgent = vi.fn();
const downloadMediaAsDataUrl = vi.fn();

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
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
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
  getViaje: vi.fn(async () => null),
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
  downloadMediaAsDataUrl: (...a: unknown[]) => downloadMediaAsDataUrl(...a),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { processInbound } = await import('./processor');
const { ImagenDemasiadoPesadaError, MAX_IMAGEN_WHATSAPP_BYTES } = await import('@/lib/meta/client');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((b.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa1' };

beforeEach(() => {
  salientes.length = 0;
  for (const m of [addGasto, guardarHuerfano, getHuerfanos, getOpenViaje, extraerComprobante,
                    subirComprobante, runAgent, getGastos, downloadMediaAsDataUrl]) m.mockReset();
  vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  getOpenViaje.mockResolvedValue(null);          // ← SIN viaje (el camino más simple)
  getHuerfanos.mockResolvedValue([]);
  getGastos.mockResolvedValue([]);
  guardarHuerfano.mockResolvedValue(true);
  subirComprobante.mockResolvedValue('t1/sin-viaje/HASH.jpg');
  addGasto.mockResolvedValue(undefined);
  runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  extraerComprobante.mockResolvedValue({
    legible: true,
    gasto: { concepto: 'diesel', monto: 2890, fecha: '2026-07-31', ocrExtra: {} },
    costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
  });
});

describe('la foto que excede el tope de tamaño (auditoría 21, MEDIO)', () => {
  it('se rechaza con el mensaje de "muy pesada", NO con el genérico de "no pude descargar"', async () => {
    downloadMediaAsDataUrl.mockRejectedValue(new ImagenDemasiadoPesadaError(9_000_000, MAX_IMAGEN_WHATSAPP_BYTES));

    await processInbound(foto);

    const dicho = salientes.join(' ');
    expect(dicho, 'el chofer tiene que saber que reenviar la MISMA foto no arregla nada')
      .toMatch(/muy pesada/i);
    expect(dicho, 'no es un fallo nuestro de descarga: no confundir los dos mensajes')
      .not.toMatch(/no pude descargar/i);
    // Y NO se procesa como comprobante: ni sube, ni corre OCR, ni se guarda.
    expect(subirComprobante).not.toHaveBeenCalled();
    expect(extraerComprobante).not.toHaveBeenCalled();
    expect(guardarHuerfano).not.toHaveBeenCalled();
  });

  it('una foto normal (dentro del tope) se sigue procesando exactamente igual que antes', async () => {
    downloadMediaAsDataUrl.mockResolvedValue('data:image/jpeg;base64,AAAA');

    await processInbound(foto);

    expect(subirComprobante).toHaveBeenCalled();
    expect(extraerComprobante).toHaveBeenCalled();
    // Sin viaje abierto, el comprobante siempre se guarda en la sala de
    // espera (`huerfanos_flujo.test.ts` ya lo cubre a fondo); lo que aquí
    // importa es que el tope NUEVO no le puso ningún freno a esto.
    expect(guardarHuerfano).toHaveBeenCalledWith('t1', 'o1', expect.objectContaining({ motivo: 'sin_viaje' }));
    expect(salientes.join(' ')).not.toMatch(/muy pesada|no pude descargar/i);
  });

  it('una falla de descarga normal (null) conserva su mensaje de siempre, sin mezclarse con el nuevo', async () => {
    downloadMediaAsDataUrl.mockResolvedValue(null);

    await processInbound(foto);

    expect(salientes.join(' ')).toMatch(/no pude descargar tu foto/i);
    expect(salientes.join(' ')).not.toMatch(/muy pesada/i);
  });
});
