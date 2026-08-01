import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL BUCLE ENTERO DE LA RE-FOTO, POR `processInbound`. 1-ago-2026.
//
// Las piezas puras ya se prueban en `intake/correccion_fecha.test.ts`. Éste
// existe porque el ENSAYO REAL de esa misma tarde falló en el cableado, no en
// las piezas: se le pidió al operador otra foto de un ticket con la fecha mal
// leída, reenvió EL MISMO archivo, y el dedup por contenido
// (`CUADRA_DEDUP_FOTOS=1`) lo descartó ANTES del OCR — en silencio.
//
// Desde su lado: hizo exactamente lo que se le pidió, el sistema no contestó
// nada, y la fecha siguió mal. Ninguna prueba de función pura podía verlo,
// porque el defecto estaba en el orden de las compuertas.
//
// Es el séptimo caso del mismo patrón en este repo ("función pura probada,
// cableado no"), así que aquí se ejercita `processInbound` de verdad.
// ═══════════════════════════════════════════════════════════════════════════

const addGasto = vi.fn();
const corregirFechaGasto = vi.fn();
const gastoExistePorHash = vi.fn();
const gastoPorHash = vi.fn();
const getGastos = vi.fn();
const extraerComprobante = vi.fn();
const runAgent = vi.fn();
const subirComprobante = vi.fn();

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/intake/ocr', () => ({
  extraerComprobante: (...a: unknown[]) => extraerComprobante(...a),
  tieneCodigoLegible: vi.fn(async () => false),
}));
vi.mock('@/lib/cuadra/intake/hash', () => ({ hashImagen: vi.fn(async () => 'HASH-DE-LA-FOTO') }));
vi.mock('@/lib/cuadra/intake/almacen', () => ({
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
  ligaComprobante: vi.fn(),
}));
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
  corregirFechaGasto: (...a: unknown[]) => corregirFechaGasto(...a),
  gastoExistePorHash: (...a: unknown[]) => gastoExistePorHash(...a),
  gastoPorHash: (...a: unknown[]) => gastoPorHash(...a),
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
  // El viaje arrancó el 1-ago; con 30 días de tolerancia la ventana es
  // [2026-07-02, hoy]. Un ticket de enero cae fuera por los dos lados.
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 3000, fechaInicio: '2026-08-01' })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
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

/** El ticket de Walmart del ensayo: impreso 01/08/26, leído como 8 de enero. */
const WALMART_MAL = {
  id: 'g-walmart', concepto: 'alimentacion', monto: 45, fecha: '2026-01-08', folio: '05461',
  ocrExtra: { emisor: 'NUEVA WAL MART DE MEXICO S DE RL DE CV', fechaImpresa: '01/08/26' },
};

describe('processInbound — pedir la re-foto y saber recibirla', () => {
  beforeEach(() => {
    salientes.length = 0;
    for (const m of [addGasto, corregirFechaGasto, gastoExistePorHash, gastoPorHash, getGastos, extraerComprobante, runAgent, subirComprobante]) m.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    process.env.CUADRA_DEDUP_FOTOS = '1';
    addGasto.mockResolvedValue(undefined);
    corregirFechaGasto.mockResolvedValue(undefined);
    getGastos.mockResolvedValue([]);
    gastoExistePorHash.mockResolvedValue(false);
    gastoPorHash.mockResolvedValue(null);
    subirComprobante.mockResolvedValue('t1/v1/HASH-DE-LA-FOTO.jpg');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('EL FALLO DEL ENSAYO: reenviar la MISMA foto ya no se traga en silencio', async () => {
    // Éste es el caso exacto del 1-ago a las 17:05: dos fotos idénticas, dos
    // `foto.dedup` en el log, cero mensajes al operador, fecha intacta.
    gastoExistePorHash.mockResolvedValue(true);
    gastoPorHash.mockResolvedValue(WALMART_MAL);

    await processInbound(foto);

    expect(salientes, 'el operador tiene que enterarse de que su reenvío no sirvió').toHaveLength(1);
    expect(salientes[0]).toMatch(/misma foto/i);
    expect(salientes[0]).toMatch(/nueva/i);
    expect(salientes[0]).toContain('$45.00');
    expect(addGasto, 'y sigue sin duplicarse').not.toHaveBeenCalled();
  });

  it('pero un reenvío cualquiera SIGUE siendo silencioso: no se le avisa de cada foto repetida', async () => {
    // La distinción es lo que evita convertir el arreglo en ruido. Un doble
    // toque o un reintento de Meta sobre un ticket con la fecha BIEN leída no
    // necesita mensaje: no hay nada que el operador pueda hacer.
    gastoExistePorHash.mockResolvedValue(true);
    gastoPorHash.mockResolvedValue({ ...WALMART_MAL, fecha: '2026-08-01' });

    await processInbound(foto);

    expect(salientes).toHaveLength(0);
  });

  it('la foto NUEVA re-fecha el gasto y NO da de alta otro', async () => {
    // El bucle cerrado. Sin esto, la foto que se pidió entra como gasto nuevo
    // y —al no traer folio con qué deduplicar— cobra el consumo dos veces.
    getGastos.mockResolvedValue([WALMART_MAL]);
    extraerComprobante.mockResolvedValue({
      legible: true,
      gasto: { concepto: 'alimentacion', monto: 45, fecha: '2026-08-01', folio: '05461', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });

    await processInbound(foto);

    expect(corregirFechaGasto).toHaveBeenCalledWith('t1', 'g-walmart', '2026-08-01');
    expect(addGasto, 'el mismo papel no puede entrar dos veces').not.toHaveBeenCalled();
    expect(salientes.join(' ')).toMatch(/ya quedó/i);
    expect(salientes.join(' ')).toContain('$45.00');
  });

  it('una foto con la fecha fuera del viaje SÍ entra, y se le pide otra nombrando el ticket', async () => {
    // El gasto se registra igual: no registrarlo por una fecha sospechosa le
    // costaría al operador un gasto que sí hizo.
    extraerComprobante.mockResolvedValue({
      legible: true,
      gasto: {
        concepto: 'alimentacion', monto: 45, fecha: '2026-01-08', folio: '05461',
        ocrExtra: { emisor: 'NUEVA WAL MART DE MEXICO S DE RL DE CV', fechaImpresa: '01/08/26' },
      },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });

    await processInbound(foto);

    expect(addGasto, 'el gasto no se pierde por una fecha en duda').toHaveBeenCalled();
    const dicho = salientes.join(' ');
    expect(dicho).toMatch(/otra foto/i);
    expect(dicho, 'sin las señas el operador no sabe cuál ticket es').toContain('NUEVA WAL MART');
    expect(dicho).toContain('05461');
    expect(dicho).toContain('01/08/26');
  });

  it('con la fecha buena no le dice nada de fechas', async () => {
    extraerComprobante.mockResolvedValue({
      legible: true,
      gasto: { concepto: 'alimentacion', monto: 45, fecha: '2026-08-01', folio: '05461', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });

    await processInbound(foto);

    expect(addGasto).toHaveBeenCalled();
    expect(salientes.join(' ')).not.toMatch(/otra foto|fecha que entendí/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA FOTO SE GUARDA CON EL GASTO — y su fallo no cuesta el gasto.
//
// Hasta el 1-ago no se guardaba ninguna: 22 gastos en producción, 0 con
// `imagen_url`. El CFF art. 30 obliga a conservar el comprobante cinco años, y
// un gasto con monto y folio pero sin el papel es una fila en una tabla.
// ═══════════════════════════════════════════════════════════════════════════
describe('processInbound — el comprobante se archiva', () => {
  beforeEach(() => {
    // Bloque HERMANO del de arriba: no hereda su `beforeEach`, así que el
    // arranque se repite entero. Sin esto, los mocks llegaban con el estado del
    // último caso del otro bloque y dos pruebas pasaban por arrastre.
    salientes.length = 0;
    for (const m of [addGasto, corregirFechaGasto, gastoExistePorHash, gastoPorHash, getGastos, extraerComprobante, runAgent, subirComprobante]) m.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
    process.env.CUADRA_DEDUP_FOTOS = '1';
    addGasto.mockResolvedValue(undefined);
    getGastos.mockResolvedValue([]);
    gastoExistePorHash.mockResolvedValue(false);
    gastoPorHash.mockResolvedValue(null);
    subirComprobante.mockResolvedValue('t1/v1/HASH-DE-LA-FOTO.jpg');
    runAgent.mockResolvedValue({ finalText: 'ok', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
    extraerComprobante.mockResolvedValue({
      legible: true,
      gasto: { concepto: 'diesel', monto: 800, fecha: '2026-08-01', folio: 'A1', ocrExtra: {} },
      costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
    });
  });

  it('la RUTA de la foto se guarda junto al gasto', async () => {
    await processInbound(foto);
    expect(addGasto).toHaveBeenCalledWith('t1', 'v1', expect.objectContaining({
      imagenUrl: 't1/v1/HASH-DE-LA-FOTO.jpg',
    }));
  });

  it('la subida arranca ANTES del OCR: esperarla después costaría segundos de pared', async () => {
    // Si alguien la mueve debajo de `extraerComprobante`, el operador paga esa
    // latencia en cada foto sin que nada lo delate.
    const orden: string[] = [];
    subirComprobante.mockImplementation(async () => { orden.push('subida'); return 'ruta'; });
    extraerComprobante.mockImplementation(async () => {
      orden.push('ocr');
      return { legible: true, gasto: { concepto: 'diesel', monto: 800, fecha: '2026-08-01', ocrExtra: {} },
               costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 } };
    });
    await processInbound(foto);
    expect(orden[0]).toBe('subida');
  });

  it('si storage falla, el gasto ENTRA igual — sin imagen, pero entra', async () => {
    // El riesgo de meter una subida en el camino del dinero es exactamente éste.
    subirComprobante.mockResolvedValue(undefined);
    await processInbound(foto);
    expect(addGasto).toHaveBeenCalled();
    expect(addGasto.mock.calls[0][2]).not.toHaveProperty('imagenUrl');
  });
});
