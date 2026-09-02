// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-7 — `processor.ts:2274-2275` (`if (dudosa) { … anotarIncidencia
// (fecha_dudosa) … }`) es el único punto donde el chofer se entera EN EL
// MOMENTO de que la foto trae una fecha fuera de la ventana del viaje. La
// mutación M24 (`if (dudosa)` → `if (false)`) la apaga.
//
// NOTA: `foto_refoto_fecha.test.ts` (existente, «una foto con la fecha fuera
// del viaje SÍ entra…») YA mata esta mutación al correr la suite completa —
// se verificó aplicando la mutación a mano: ese archivo enrojece. El
// hallazgo del auditor la marcó SOBREVIVE porque su script de mutación
// corrió solo los archivos con prefijo `src/lib/likida/processor` (la tabla
// no la marca «(suite)», a diferencia de M4/M7/M12/M14-17/M19/M21), y
// `foto_refoto_fecha.test.ts` no calza ese prefijo aunque sí prueba
// `processor.ts`. Esta prueba es un segundo ancla, más cercana al síntoma
// exacto de PRU-7: el `logger.info('foto.fecha_dudosa', …)` y el texto que
// se manda, con una fecha meses antes de que abriera el viaje (fuera de la
// tolerancia de 30 días).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const addGasto = vi.fn();
const getGastos = vi.fn();
const extraerComprobante = vi.fn();
const runAgent = vi.fn();
const subirComprobante = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/likida/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH-DE-LA-FOTO') }));
vi.mock('@/lib/likida/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
  ligaComprobante: vi.fn(),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
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
  addGasto: (...a: unknown[]) => addGasto(...a),
  corregirFechaGasto: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false),
  gastoPorHash: vi.fn(async () => null),
  getGastos: (...a: unknown[]) => getGastos(...a),
  updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  guardarFotoPendiente: vi.fn(async () => null), existeFotoPendiente: vi.fn(async () => false),
  reclamarFotoPendiente: vi.fn(async () => null),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  // El viaje abrió el 2026-08-01: un ticket del 2026-07-30 (dos días antes)
  // cae fuera de la ventana por el lado de "antes de que empezara".
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, fechaInicio: '2026-08-01' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
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

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: 'wa1' };

describe('PRU-7: la foto con fecha fuera de la ventana avisa AL MOMENTO', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, getGastos, extraerComprobante, runAgent, subirComprobante, logger.info]) m.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    process.env.LIKIDA_DEDUP_FOTOS = '1';
    addGasto.mockResolvedValue(undefined);
    getGastos.mockResolvedValue([]);
    subirComprobante.mockResolvedValue('t1/v1/HASH-DE-LA-FOTO.jpg');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
    extraerComprobante.mockResolvedValue({
      legible: true,
      // El viaje abrió el 2026-08-01 con 30 días de tolerancia hacia atrás
      // (ventana ≥ 2026-07-02): un ticket del 8 de enero cae fuera por meses.
      gasto: { concepto: 'alimentacion', monto: 900, fecha: '2026-01-08', folio: 'F-9', ocrExtra: { emisor: 'PEMEX' } },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
  });

  it('logger.info("foto.fecha_dudosa") se dispara y el chofer recibe el aviso EN ESE TURNO', async () => {
    await processInbound(foto);

    expect(logger.info).toHaveBeenCalledWith('foto.fecha_dudosa', expect.objectContaining({
      viaje: 'v1', fecha: '2026-01-08',
    }));
    // El gasto entra igual: no perderlo por una fecha en duda.
    expect(addGasto).toHaveBeenCalled();
    // Y el operador se entera AHORA, no hasta el cuadre final.
    const dicho = salientes.join(' ');
    expect(dicho.length).toBeGreaterThan(0);
    expect(dicho).toContain('$900.00');
  });
});
