import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD 22-ago-2026 · DAT-01 (CRÍTICO) — EL MISMO COMPROBANTE, DOS
// VECES, PORQUE EL REINTENTO ERA NUESTRO.
//
// Dos hechos que se sumaban:
//
//   1. `imgHash` sólo se calculaba con `LIKIDA_DEDUP_FOTOS === '1'`, y esa
//      bandera NO está puesta en producción. Sin hash en la fila, el índice
//      `uq_gasto_img_hash` (0027) no puede disparar: llevaba meses indexando
//      el vacío. El único otro candado, `uq_gasto_cfdi_uuid`, no aplica a un
//      ticket de gasolinera — ésos no traen UUID.
//
//   2. El `say()` que va DESPUÉS de `addGasto` (el acuse, el aviso de fecha,
//      el resumen de la ráfaga) puede lanzar: Meta 500, red. Cuando lanza, el
//      catch general de `procesarTurno` suelta el claim → la fila durable se
//      reintenta → el MISMO mensaje corre otra vez, con otro `randomUUID()` de
//      gasto y otro OCR, y el diésel de $8,000 queda comprobado dos veces
//      contra el mismo anticipo.
//
// Lo que fija este archivo:
//   · el hash se calcula SIEMPRE y viaja en el insert (sin bandera de por medio);
//   · el `wamid` viaja en el insert, que es la llave que cierra el caso (2);
//   · el 23505 contra `uq_gasto_wa_message_id` es benigno y CALLADO — el gasto
//     ya está registrado y relanzarlo dejaría a la bandeja reintentando en bucle;
//   · el huérfano nace con su hash, para que la sala de espera no acumule N
//     copias del mismo papel que el «sí» del operador adjuntaría todas.
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const addGasto = vi.fn();
const extraerComprobante = vi.fn();
const guardarHuerfano = vi.fn();
const intakeDelta = vi.fn();
const getGastos = vi.fn();
const gastoExistePorHash = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
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
  releaseMessageClaim: vi.fn(), completarMessageClaim: vi.fn(),
  intakeDelta: (...a: unknown[]) => intakeDelta(...a), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...a),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => addGasto(...a),
  getGastos: (...a: unknown[]) => getGastos(...a), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(),
  gastoExistePorHash: (...a: unknown[]) => gastoExistePorHash(...a),
  gastoPorHash: vi.fn(async () => null),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 10_000 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

const WAMID = 'wamid.HBgMNTIxOTk5MzcwMDc3OQ==';
const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'media1', waMessageId: WAMID };

/** El 23505 que Postgres devuelve al chocar contra un índice, con su nombre. */
function choque(indice: string): Error & { code?: string } {
  const e = new Error(`duplicate key value violates unique constraint "${indice}"`) as Error & { code?: string };
  e.code = '23505';
  return e;
}

// Arriba y no dentro de un `describe`: un `beforeEach` de bloque NO alcanza al
// bloque de al lado, y un `addGasto` sin resetear deja que `mock.calls[0]` sea
// la llamada de OTRA prueba — un verde que no prueba nada.
beforeEach(() => {
  salientes.length = 0;
  runAgent.mockReset(); addGasto.mockReset(); extraerComprobante.mockReset();
  guardarHuerfano.mockReset(); guardarHuerfano.mockResolvedValue(true);
  intakeDelta.mockReset(); intakeDelta.mockResolvedValue(1);
  getGastos.mockReset(); getGastos.mockResolvedValue([]);
  gastoExistePorHash.mockReset(); gastoExistePorHash.mockResolvedValue(false);
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  // La bandera vieja NO se pone: el punto de la prueba es que ya no existe.
  delete process.env.LIKIDA_DEDUP_FOTOS;
  extraerComprobante.mockResolvedValue({
    gasto: { concepto: 'diesel', monto: 8000, fecha: '2026-08-01', ocrExtra: {} },
    costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    legible: true,
  });
});

describe('DAT-01 · el mismo mensaje no da de alta el gasto dos veces', () => {

  it('SIN la bandera, el gasto entra CON su hash de imagen', async () => {
    // Era el hallazgo entero: en producción `img_hash` iba siempre en null y
    // `uq_gasto_img_hash` no podía disparar nunca.
    addGasto.mockResolvedValue(undefined);
    await processInbound(foto);

    expect(addGasto).toHaveBeenCalledTimes(1);
    const g = addGasto.mock.calls[0][2] as { imgHash?: string };
    expect(g.imgHash, 'sin hash, el índice único de la 0027 indexa el vacío').toBeTruthy();
    // SHA-256 en hexadecimal: 64 caracteres.
    expect(g.imgHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('y CON el wamid, que es lo que hace idempotente el reproceso', async () => {
    addGasto.mockResolvedValue(undefined);
    await processInbound(foto);

    const g = addGasto.mock.calls[0][2] as { waMessageId?: string };
    expect(g.waMessageId).toBe(WAMID);
  });

  it('el pre-chequeo por hash corre SIN bandera (ahorra el OCR del reenvío)', async () => {
    gastoExistePorHash.mockResolvedValue(true);
    await processInbound(foto);

    expect(gastoExistePorHash).toHaveBeenCalled();
    expect(addGasto, 'ya lo teníamos: no se da de alta otra vez').not.toHaveBeenCalled();
  });

  // ── EL CASO QUE COSTABA DINERO ────────────────────────────────────────────
  it('reproceso del MISMO wamid: la base lo rebota y NO se relanza ni se avisa', async () => {
    // Segunda vuelta de la bandeja durable: el gasto ya está en la base con
    // este wamid. Si esto se relanzara, el turno volvería a fallar, el claim se
    // volvería a soltar y la fila se reintentaría en bucle.
    addGasto.mockRejectedValue(choque('uq_gasto_wa_message_id'));

    const resultado = await processInbound(foto);

    expect(resultado, 'el turno terminó bien: el comprobante YA está registrado').toBe('procesado');
    expect(salientes, 'no hay nada que decirle: el turno anterior ya habló').toEqual([]);
    expect(salientes.join(' ')).not.toMatch(/se me trabó/i);
  });

  it('el huérfano de "llegó tarde" nace con su hash (si no, se adjunta N veces)', async () => {
    const tarde = new Error('el viaje ya tiene liquidación emitida') as Error & { code?: string };
    tarde.code = 'CU001';
    addGasto.mockRejectedValue(tarde);

    await processInbound(foto);

    expect(guardarHuerfano).toHaveBeenCalledTimes(1);
    const h = guardarHuerfano.mock.calls[0][2] as { gasto: { imgHash?: string } };
    expect(h.gasto.imgHash, 'sin hash en el jsonb, uq_huerfano_img_hash no puede dispararse')
      .toMatch(/^[0-9a-f]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DAT-18 · LA MARCA DE ESCALA TIENE QUE LLEGAR AL GASTO.
//
// `esMontoImplausible` es pura y está probada aparte (cuadre/monto_y_moneda);
// lo que este bloque prueba es el CABLEADO, que es donde este repo ya se ha
// equivocado seis veces: una función correcta que nadie llama. Si la marca no
// entra en `ocrExtra`, el motor no puede levantar la diferencia y el contralor
// firma una cifra que nadie miró.
// ═══════════════════════════════════════════════════════════════════════════
describe('DAT-18 · el monto fuera de escala se marca en el gasto', () => {
  beforeEach(() => {
    addGasto.mockResolvedValue(undefined);
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('un diésel de $850,000 en un viaje de $10,000 de anticipo entra MARCADO', async () => {
    // El punto decimal perdido, con confianza 0.95: el OCR está igual de
    // seguro de $850.00 que de $850,000.00.
    extraerComprobante.mockResolvedValue({
      gasto: { concepto: 'diesel', monto: 850_000, fecha: '2026-08-01', ocrConfianza: 0.95, ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
      legible: true,
    });

    await processInbound(foto);

    const g = addGasto.mock.calls[0][2] as { ocrExtra?: Record<string, unknown>; monto: number };
    expect(g.ocrExtra?.montoImplausible).toBe(true);
    expect(g.monto, 'el gasto ENTRA: la cifra puede ser real y el papel es del operador').toBe(850_000);
  });

  it('CONTROL — el diésel de $8,000 del mismo viaje no lleva marca', async () => {
    extraerComprobante.mockResolvedValue({
      gasto: { concepto: 'diesel', monto: 8_000, fecha: '2026-08-01', ocrConfianza: 0.95, ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
      legible: true,
    });

    await processInbound(foto);

    const g = addGasto.mock.calls[0][2] as { ocrExtra?: Record<string, unknown> };
    expect(g.ocrExtra?.montoImplausible).toBeUndefined();
  });
});
