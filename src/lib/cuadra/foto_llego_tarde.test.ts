import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO (rubro pruebas) — `gasto_tarde.test.ts` prueba el TEXTO
// del cableado (`P.slice(...).toContain('sendText')`), no el cableado: un
// `if (llegoTarde(e))` cambiado a `if (false && llegoTarde(e))` deja el texto
// vecino intacto y esa prueba sigue verde. Sexta aparición del mismo patrón
// en este repo ("función pura probada, cableado no").
//
// Este archivo ejercita `processInbound` de verdad: `addGasto` lanza el error
// CU001 real y se verifica la RESPUESTA, no el código fuente.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const addGasto = vi.fn();
const extraerComprobante = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/intake/ocr', () => ({ extraerComprobante: (...a: unknown[]) => extraerComprobante(...a) }));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: (...a: unknown[]) => addGasto(...a),
  getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
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
vi.mock('@/lib/cuadra/costos', () => ({
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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: 'wa1' };

describe('processInbound — la foto que llega tarde avisa la verdad, no la pierde', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); addGasto.mockReset(); extraerComprobante.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    extraerComprobante.mockResolvedValue({
      gasto: { concepto: 'diesel', monto: 800, fecha: '2026-08-01', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
      legible: true,
    });
  });

  it('con CU001 (la 0036), avisa que llegó tarde con el monto EXACTO, no "se me trabó"', async () => {
    const err = new Error('el viaje ya tiene liquidación emitida') as Error & { code?: string };
    err.code = 'CU001';
    addGasto.mockRejectedValue(err);

    await processInbound(foto);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/llegó después de que cerré tu liquidación/i);
    expect(salientes[0]).toContain('$800.00');
    expect(salientes[0]).toMatch(/siguiente viaje|oficina/i);
    expect(salientes[0]).not.toMatch(/se me trabó/i);
  });

  it('con un error normal, sí cae al genérico (no se traga el catch)', async () => {
    addGasto.mockRejectedValue(new Error('fallo de red cualquiera'));
    await processInbound(foto);
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/se me trabó/i);
  });

  it('control: si addGasto SÍ funciona, no avisa nada de "llegó tarde"', async () => {
    addGasto.mockResolvedValue(undefined);
    runAgent.mockResolvedValue({ finalText: 'Listo', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
    await processInbound(foto);
    expect(salientes.join(' ')).not.toMatch(/llegó después de que cerré/i);
  });
});
