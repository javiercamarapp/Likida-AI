import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CHOFER QUE NO DICE «HOLA». 1-ago-2026.
//
// Termina la ruta, saca el fajo y manda once fotos de golpe, sin viaje abierto.
// Hasta hoy se le contestaba «No tienes un viaje abierto para liquidar ahorita»
// y sus once comprobantes se tiraban — mientras que el XML del CFDI, en ese
// MISMO corte, sí se conservaba. El producto pedía un documento y se negaba a
// recibir justo el que importa.
//
// Se ejercita `processInbound` de verdad. Las funciones puras ya se prueban en
// `intake/huerfanos.test.ts`; lo que ha fallado hoy siete veces es el cableado.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const guardarHuerfano = vi.fn();
const getHuerfanos = vi.fn();
const resolverHuerfanos = vi.fn();
const marcarHuerfanosOfrecidos = vi.fn();
const getOpenViaje = vi.fn();
const extraerComprobante = vi.fn();
const subirComprobante = vi.fn();
const runAgent = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/cuadra/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH') }));
vi.mock('@/lib/cuadra/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
  ligaComprobante: vi.fn(),
}));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: (...a: unknown[]) => getOpenViaje(...a),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 1), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  addGasto: (...a: unknown[]) => addGasto(...a),
  guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...a),
  getHuerfanos: (...a: unknown[]) => getHuerfanos(...a),
  resolverHuerfanos: (...a: unknown[]) => resolverHuerfanos(...a),
  marcarHuerfanosOfrecidos: (...a: unknown[]) => marcarHuerfanosOfrecidos(...a),
  getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
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
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, origen: 'Silao', destino: 'N. Laredo', fechaInicio: '2026-08-01' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base'); }),
}));
vi.mock('@/lib/cuadra/config', () => ({
  getConfig: vi.fn(async () => ({
    politica: [], hidrocarburos: { claves: [] }, estimulos: { clavesPeaje: [] },
    validacion: { fechaToleranciaDiasAntes: 30 },
  })),
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
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { processInbound } = await import('./processor');

const salientes: string[] = [];
const fetchSpy = vi.fn(async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((b.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa1' };
const texto = (t: string) => ({ from: '5219993700779', type: 'text' as const, text: t, waMessageId: `wa-${t}` });

const HUERFANO = (id: string, monto: number, ofrecido = false) => ({
  id, gasto: { id: `g-${id}`, concepto: 'diesel', monto, ocrExtra: {} },
  motivo: 'sin_viaje' as const, creadoEn: '2026-07-31T10:00:00Z',
  ofrecidoEn: ofrecido ? '2026-08-01T10:00:00Z' : undefined,
});

describe('el chofer que manda fotos sin viaje abierto', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                     marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante, runAgent]) m.mockReset();
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    getOpenViaje.mockResolvedValue(null);          // ← SIN viaje
    getHuerfanos.mockResolvedValue([]);
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

  it('EL FALLO: su foto ya no se tira, se guarda', async () => {
    await processInbound(foto);
    expect(guardarHuerfano).toHaveBeenCalledWith('t1', 'o1', expect.objectContaining({ motivo: 'sin_viaje' }));
    expect(salientes.join(' ')).toMatch(/no se pierden/i);
    expect(salientes.join(' '), 'ya no puede ser la única respuesta').not.toMatch(/^No tienes un viaje abierto/);
  });

  it('la imagen se archiva, no solo el número: el OCR se puede discutir, el papel no', async () => {
    await processInbound(foto);
    expect(subirComprobante).toHaveBeenCalled();
    expect(guardarHuerfano.mock.calls[0][2]).toMatchObject({ rutaImagen: 't1/sin-viaje/HASH.jpg' });
  });

  it('en una ráfaga de once NO acusa once veces', async () => {
    // Mismo criterio que el acuse de ráfaga y el aviso de acercamiento: tres
    // mensajes idénticos seguidos hacen ver el producto roto.
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100), HUERFANO('b', 200)]);
    await processInbound(foto);
    expect(salientes).toHaveLength(0);
  });

  it('si no se puede guardar, se lo DICE en vez de dejarlo creer que sí', async () => {
    guardarHuerfano.mockResolvedValue(false);
    await processInbound(foto);
    expect(salientes.join(' ')).toMatch(/no pude guardar/i);
  });

  it('una foto ilegible se pide otra vez, no se guarda basura', async () => {
    extraerComprobante.mockResolvedValue({
      legible: false, motivo: 'ilegible',
      gasto: { concepto: 'otro', monto: 0, ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
    await processInbound(foto);
    expect(guardarHuerfano).not.toHaveBeenCalled();
    expect(salientes.join(' ')).toMatch(/difícil de leer/i);
  });

  it('un texto sin viaje sigue contestando lo de siempre', async () => {
    await processInbound(texto('hola'));
    expect(salientes.join(' ')).toMatch(/No tienes un viaje abierto/);
  });
});

describe('cuando por fin hay viaje, se pregunta antes de adjuntar', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, guardarHuerfano, getHuerfanos, resolverHuerfanos,
                     marcarHuerfanosOfrecidos, getOpenViaje, extraerComprobante, subirComprobante, runAgent]) m.mockReset();
    vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    getOpenViaje.mockResolvedValue('v1');          // ← CON viaje
    guardarHuerfano.mockResolvedValue(true);
    addGasto.mockResolvedValue(undefined);
    subirComprobante.mockResolvedValue('ruta');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('ofrece con la lista y la ruta, y NO adjunta nada todavía', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 2890), HUERFANO('b', 980)]);
    await processInbound(texto('hola'));
    const m = salientes.join(' ');
    expect(m).toMatch(/¿Los agrego a este viaje\?/);
    expect(m).toContain('$3,870.00');
    expect(m).toContain('Silao→N. Laredo');
    expect(addGasto, 'preguntar no es adjuntar').not.toHaveBeenCalled();
    expect(marcarHuerfanosOfrecidos).toHaveBeenCalledWith('t1', ['a', 'b']);
  });

  it('con un «sí» los adjunta y los marca DESPUÉS de insertarlos', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 2890, true), HUERFANO('b', 980, true)]);
    await processInbound(texto('sí'));
    expect(addGasto).toHaveBeenCalledTimes(2);
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a', 'b'], 'adjuntado', 'v1');
    expect(salientes.join(' ')).toContain('$3,870.00');
  });

  it('si uno falla al insertarse, NO se marca como puesto', async () => {
    // Marcar primero dejaría un comprobante contado como agregado que no está
    // en ningún lado, y nadie volvería a ofrecerlo.
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true), HUERFANO('b', 200, true)]);
    addGasto.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    await processInbound(texto('sí'));
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a'], 'adjuntado', 'v1');
  });

  it('con un «no» los descarta sin tocar el viaje', async () => {
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100, true)]);
    await processInbound(texto('no'));
    expect(addGasto).not.toHaveBeenCalled();
    expect(resolverHuerfanos).toHaveBeenCalledWith('t1', ['a'], 'descartado', null);
  });

  it('«listo» NO dispara la oferta: cerrar no puede costarle dos intentos', async () => {
    // Interceptar un cierre con una pregunta lo obligaría a escribir `listo` dos
    // veces, y en una sala eso se lee como que el sistema no entendió.
    getHuerfanos.mockResolvedValue([HUERFANO('a', 100)]);
    await processInbound(texto('listo'));
    expect(marcarHuerfanosOfrecidos).not.toHaveBeenCalled();
    expect(salientes.join(' ')).not.toMatch(/¿Los agrego/);
  });

  it('sin nada esperando, el flujo normal no se entera de que esto existe', async () => {
    getHuerfanos.mockResolvedValue([]);
    await processInbound(texto('hola'));
    expect(marcarHuerfanosOfrecidos).not.toHaveBeenCalled();
    expect(runAgent, 'el mensaje tiene que llegar al agente como siempre').toHaveBeenCalled();
  });

  it('un error leyendo la sala de espera no le impide usar su viaje', async () => {
    // `getHuerfanos` devuelve [] ante un fallo de lectura, a propósito.
    getHuerfanos.mockResolvedValue([]);
    await processInbound(texto('cuánto llevo'));
    expect(runAgent).toHaveBeenCalled();
  });
});
