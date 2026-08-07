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
const guardarHuerfano = vi.fn();
const ubicarGastoPorHash = vi.fn();
const intakeDelta = vi.fn();
const getGastos = vi.fn();

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
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: (...a: unknown[]) => intakeDelta(...a), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: (...a: unknown[]) => ubicarGastoPorHash(...a),
  // Sala de espera de comprobantes sin viaje (mig. 0040). Sin estas cuatro,
  // `getHuerfanos` llega `undefined` y el processor truena en el `.length`.
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...a),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: (...a: unknown[]) => addGasto(...a),
  getGastos: (...a: unknown[]) => getGastos(...a), updateGastoCfdiXml: vi.fn(),
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
    guardarHuerfano.mockReset(); guardarHuerfano.mockResolvedValue(true);
    ubicarGastoPorHash.mockReset(); ubicarGastoPorHash.mockResolvedValue(null);
    intakeDelta.mockReset(); intakeDelta.mockResolvedValue(1);
    getGastos.mockReset(); getGastos.mockResolvedValue([]);
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

  // EL MENSAJE CAMBIÓ A PROPÓSITO EL 1-ago. Decía «NO entró. Guárdalo: mándalo
  // en tu siguiente viaje o pídele a la oficina que lo agregue», y eso mandaba
  // al operador a un trámite QUE NO EXISTE: no hay forma de que la oficina
  // agregue un comprobante a un viaje ya liquidado, ni desde el panel ni desde
  // ningún lado. El comprobante se perdía igual, solo que despacio y con el
  // operador cargando un papel que nadie iba a capturar.
  //
  // Ahora pasa a la sala de espera (mig. 0040) y se le ofrece en su próximo
  // viaje. Lo que esta prueba fija es lo que NO puede volver: que se le diga
  // que no entró sin haberlo guardado.
  it('con CU001 (la 0036), lo GUARDA y se lo dice con el monto exacto', async () => {
    const err = new Error('el viaje ya tiene liquidación emitida') as Error & { code?: string };
    err.code = 'CU001';
    addGasto.mockRejectedValue(err);

    await processInbound(foto);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toContain('$800.00');
    expect(salientes[0], 'tiene que decir que ya cerró, no "se me trabó"').toMatch(/ya cerré esta liquidación/i);
    expect(salientes[0], 'y que NO se perdió, que es lo que cambió').toMatch(/no se perdió/i);
    expect(salientes[0]).toMatch(/siguiente viaje/i);
    expect(salientes[0]).not.toMatch(/se me trabó/i);
    expect(guardarHuerfano, 'decirle que lo guardó sin guardarlo sería peor que el mensaje viejo')
      .toHaveBeenCalledWith('t1', 'o1', expect.objectContaining({ motivo: 'tras_liquidar' }));
  });

  it('y si NO se pudo guardar, se lo dice en vez de prometerle que lo tiene', async () => {
    const err = new Error('ya liquidado') as Error & { code?: string };
    err.code = 'CU001';
    addGasto.mockRejectedValue(err);
    guardarHuerfano.mockResolvedValueOnce(false);

    await processInbound(foto);

    expect(salientes[0]).toMatch(/no lo pude guardar/i);
    expect(salientes[0]).toMatch(/consérvalo/i);
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

  // AUDITORÍA 8, ALTO (backend): los duplicados benignos (23505 contra los
  // índices únicos de hash e imagen) nunca se ejercitaban a través de
  // `processInbound` real — solo como función pura en gasto_tarde.test.ts.
  it('duplicado por hash de imagen (23505, ráfaga): se ignora en silencio, no avisa nada', async () => {
    const err = new Error('duplicate key value violates unique constraint "uq_gasto_img_hash"') as Error & { code?: string };
    err.code = '23505';
    addGasto.mockRejectedValue(err);
    process.env.CUADRA_DEDUP_FOTOS = '1';

    await processInbound(foto);

    expect(salientes, 'un duplicado benigno no debe generar ningún mensaje').toHaveLength(0);
    delete process.env.CUADRA_DEDUP_FOTOS;
  });

  it('duplicado por CFDI (23505, mismo comprobante dos veces): se ignora en silencio', async () => {
    extraerComprobante.mockResolvedValue({
      gasto: { concepto: 'diesel', monto: 800, fecha: '2026-08-01', cfdiUuid: 'u1', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
      legible: true,
    });
    const err = new Error('duplicate key value violates unique constraint "uq_gasto_cfdi_uuid"') as Error & { code?: string };
    err.code = '23505';
    addGasto.mockRejectedValue(err);

    await processInbound(foto);

    expect(salientes, 'el mismo CFDI dos veces es benigno: el comprobante ya está registrado').toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL ÍNDICE ES DE TODA LA FLOTA, EL PRE-CHEQUEO ES DE UN VIAJE. 1-ago-2026.
//
// `uq_gasto_img_hash` es `unique(tenant_id, img_hash)`; `gastoExistePorHash`
// mira un solo viaje. Una foto ya registrada en OTRO viaje pasa el pre-chequeo,
// la rechaza el índice con 23505, y el processor la tomaba por una carrera de
// ráfaga: `logger.info('foto.dedup_race')` y `return`, sin decir nada.
//
// Medido en producción con un operador que reenvió su fajo: DIEZ fotos
// rechazadas, cero mensajes. Desde su lado las mandó y no pasó nada — el tercer
// caso del mismo patrón en un día.
// ═══════════════════════════════════════════════════════════════════════════
describe('la foto que ya estaba en otro viaje', () => {
  const duplicado = () => {
    const err = new Error('duplicate key value violates unique constraint "uq_gasto_img_hash"') as Error & { code?: string };
    err.code = '23505';
    return err;
  };

  beforeEach(() => {
    // Bloque HERMANO: no hereda el `beforeEach` de arriba. Sin repetirlo,
    // `salientes` llega con el mensaje del caso anterior y las dos pruebas de
    // silencio pasan o fallan por arrastre, no por lo que miden.
    salientes.length = 0;
    runAgent.mockReset(); addGasto.mockReset(); extraerComprobante.mockReset();
    guardarHuerfano.mockReset(); guardarHuerfano.mockResolvedValue(true);
    ubicarGastoPorHash.mockReset(); ubicarGastoPorHash.mockResolvedValue(null);
    intakeDelta.mockReset(); intakeDelta.mockResolvedValue(1);
    getGastos.mockReset(); getGastos.mockResolvedValue([]);
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    process.env.CUADRA_DEDUP_FOTOS = '1';
    extraerComprobante.mockResolvedValue({
      gasto: { concepto: 'diesel', monto: 800, fecha: '2026-08-01', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
      legible: true,
    });
  });

  it('se lo DICE, con el viaje donde ya está y el monto', async () => {
    addGasto.mockRejectedValue(duplicado());
    ubicarGastoPorHash.mockResolvedValue({ viajeId: 'v-otro', folio: 'VJ-2026-0801', monto: 800 });

    await processInbound(foto);

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toContain('VJ-2026-0801');
    expect(salientes[0]).toContain('$800.00');
    expect(salientes[0], 'y por qué no lo puso aquí').toMatch(/no lo agregué aquí|dos veces/i);
  });

  it('pero la carrera de verdad —dos fotos idénticas del MISMO viaje— sigue callada', async () => {
    // Ahí sí es benigno y avisar sería ruido: el gasto ya está en este viaje.
    addGasto.mockRejectedValue(duplicado());
    ubicarGastoPorHash.mockResolvedValue({ viajeId: 'v1', folio: 'VJ-1', monto: 800 });

    await processInbound(foto);

    expect(salientes).toHaveLength(0);
  });

  it('si no se puede averiguar dónde está, se calla en vez de inventar un viaje', async () => {
    addGasto.mockRejectedValue(duplicado());
    ubicarGastoPorHash.mockResolvedValue(null);

    await processInbound(foto);

    expect(salientes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL RESUMEN AL CERRAR LA RÁFAGA. 1-ago-2026.
//
// Un operador mandó DIECIOCHO fotos de golpe y no recibió una sola palabra
// sobre ellas: diez ya estaban registradas en otro viaje, tres eran
// acercamientos a códigos, dos eran idénticas. Todos caminos CORRECTOS y todos
// silenciosos. Desde su lado, mandó dieciocho fotos y no pasó nada — y un
// chofer no va a escribir después para preguntar: da por hecho que se perdieron.
//
// Avisar por foto tampoco vale: serían diez mensajes seguidos.
// ═══════════════════════════════════════════════════════════════════════════
describe('la ráfaga termina diciendo qué quedó', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); addGasto.mockReset(); extraerComprobante.mockReset();
    guardarHuerfano.mockReset(); guardarHuerfano.mockResolvedValue(true);
    ubicarGastoPorHash.mockReset(); ubicarGastoPorHash.mockResolvedValue(null);
    intakeDelta.mockReset(); getGastos.mockReset(); getGastos.mockResolvedValue([]);
    addGasto.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    process.env.CUADRA_DEDUP_FOTOS = '1';
    extraerComprobante.mockResolvedValue({
      gasto: { concepto: 'diesel', monto: 800, fecha: '2026-08-01', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 }, legible: true,
    });
  });

  /** Entra viendo `entrada` fotos en vuelo y sale dejando `salida`. */
  const rafaga = (entrada: number, salida: number) =>
    intakeDelta.mockResolvedValueOnce(entrada).mockResolvedValueOnce(salida);

  it('EL FALLO: la última foto de la ráfaga dice cuántos comprobantes quedaron', async () => {
    rafaga(7, 0);
    getGastos.mockResolvedValue([
      { id: 'a', concepto: 'diesel', monto: 800 }, { id: 'b', concepto: 'caseta', monto: 200 },
    ]);

    await processInbound(foto);

    const dicho = salientes.join(' ');
    expect(dicho, 'el operador tiene que saber que sus fotos hicieron algo').toMatch(/ya revisé tus fotos/i);
    expect(dicho).toContain('2 comprobantes');
    expect(dicho).toContain('$1,000.00');
    expect(dicho).toMatch(/escribe \*listo\*/);
  });

  it('a media ráfaga NO resume: solo la que la cierra', async () => {
    rafaga(7, 3);
    await processInbound(foto);
    expect(salientes.join(' ')).not.toMatch(/ya revisé tus fotos/i);
  });

  it('una foto SUELTA tampoco: su propio camino ya habló', async () => {
    rafaga(1, 0);
    await processInbound(foto);
    expect(salientes.join(' ')).not.toMatch(/ya revisé tus fotos/i);
  });

  it('los duplicados NO inflan el total del resumen', async () => {
    // `monto <= 0` no suma; el resumen es orientativo y no puede contradecir al
    // cuadre, que excluye copias.
    rafaga(3, 0);
    getGastos.mockResolvedValue([
      { id: 'a', concepto: 'diesel', monto: 800 }, { id: 'b', concepto: 'otro', monto: 0 },
    ]);
    await processInbound(foto);
    expect(salientes.join(' ')).toContain('$800.00');
  });

  it('EN RÁFAGA, la foto que ya está en otro viaje se calla: la cubre el resumen', async () => {
    // Diez de éstos serían diez mensajes seguidos, que es el antipatrón que ya
    // hizo ver roto este producto tres veces.
    rafaga(9, 4);
    const err = new Error('duplicate key value violates unique constraint "uq_gasto_img_hash"') as Error & { code?: string };
    err.code = '23505';
    addGasto.mockRejectedValue(err);
    ubicarGastoPorHash.mockResolvedValue({ viajeId: 'v-otro', folio: 'VJ-9', monto: 800 });

    await processInbound(foto);

    expect(salientes).toHaveLength(0);
    expect(ubicarGastoPorHash, 'ni siquiera se pregunta: es una consulta por foto').not.toHaveBeenCalled();
  });

  it('si falla el resumen, la foto ya entró igual', async () => {
    // La PRIMERA lectura es la del emparejamiento, y esa tiene que funcionar o
    // el fallo no sería del resumen sino del intake entero.
    rafaga(4, 0);
    getGastos.mockResolvedValueOnce([]).mockRejectedValue(new Error('base caída'));
    await processInbound(foto);
    expect(addGasto).toHaveBeenCalled();
  });
});
