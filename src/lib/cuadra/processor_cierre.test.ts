import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el cierre sin PDF era invisible para todos.
//
// `guardar_liquidacion` devuelve `pdf_generado: Boolean(pdfPath)` y pone
// `pdfPath = undefined` si `generarLiquidacionPDF` lanza o si el upload a storage
// falla. La liquidación se guarda IGUAL. Pero el processor solo miraba `closed` y
// nunca leía `pdf_generado`: pedía una URL firmada de un objeto inexistente,
// `createSignedUrl` devolvía `{data:null,error}` —y el error se descartaba en el
// destructuring—, `data?.signedUrl` era falsy, no había `else`, y el `catch` no se
// disparaba.
//
// Resultado: la liquidación queda cerrada, el operador espera el documento que
// `prompts.ts` le prometió ("Avísale que le llega su liquidación en PDF"), no
// llega, y en los logs no hay `pdf.send`, ni warn, ni nada. En el demo es el paso
// 3 del guion fallando en silencio.
// ═══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────
// AUDITORÍA 5 · ALTO — este archivo mockeaba `@/lib/cuadra/tools` y
// `@/lib/meta/client` ENTEROS, así que el camino real de envío no se ejecutaba
// nunca y `tools.ts` tenía cobertura cero. Ahora los dos módulos corren de
// verdad: el único borde mockeado es `fetch` hacia la Graph API, y lo que se
// afirma es el SOBRE que sale hacia Meta, no una llamada a un espía.
//
// Ganancia concreta: con el espía, `sendDocument(msg.from, …)` se veía igual
// mandando al `521…` que Meta rechaza que al `52…` que acepta. Ahora no.
// ───────────────────────────────────────────────────────────────────────────

const runAgent = vi.fn();
const createSignedUrl = vi.fn();
const getOpenViaje = vi.fn<(tenantId: string, operadorId: string) => Promise<string | null>>(async () => 'v1');
const saveCfdiXmlRaw = vi.fn();
const claimMessage = vi.fn<(id: string) => Promise<'nuevo' | 'duplicado' | 'indeterminado'>>(async () => 'nuevo');
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// ── EL ÚNICO BORDE: la Graph API ────────────────────────────────────────────
type Salida = { url: string; body: Record<string, unknown> };
const salientes: Salida[] = [];
/** Contenido de cada media entrante, por `mediaId`. */
const media = new Map<string, string>();

const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/messages')) {
    salientes.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    return ok({ messages: [{ id: 'wamid.TEST' }] });
  }
  if (u.startsWith('https://media.test/')) {
    const id = u.slice('https://media.test/'.length);
    return media.has(id)
      ? new Response(media.get(id)!, { status: 200 })
      : new Response('no existe', { status: 404 });
  }
  // Metadatos del media: Meta devuelve la URL real de descarga.
  const id = u.split('/').pop()!;
  return ok({ url: `https://media.test/${id}`, mime_type: 'text/xml' });
});

/** Los mensajes de texto que salieron hacia Meta, en orden. */
const textos = () => salientes.filter((s) => s.body.type === 'text').map((s) => String((s.body.text as { body: string }).body));
const documentos = () => salientes.filter((s) => s.body.type === 'document');

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: (t: string, o: string) => getOpenViaje(t, o),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: (...a: unknown[]) => claimMessage(...(a as [string])),
  acquireViajeLock: vi.fn(async () => true),
  releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: (...a: unknown[]) => saveCfdiXmlRaw(...a), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  // Con datos de responsable y el aviso ya puesto a disposición: sin esto el
  // processor bloquea el tratamiento (LFPDPPP art. 16) y nada de lo de abajo
  // llega a correr.
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida',
    urlAvisoIntegral: 'https://flota.mx/privacidad',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  // `tools.ts` ahora se importa DE VERDAD y estos son sus accesos a datos.
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a), upload: async () => ({ error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/cuadra/intake/cfdi_xml', () => ({
  parseCfdiXml: () => ({ uuid: 'uuid-abc', total: 100, fecha: '2026-05-01' }),
}));

const { processInbound } = await import('./processor');

const listo = { from: '5219993700779', type: 'text' as const, text: 'listo', waMessageId: 'wa1' };

const cierre = (pdf_generado: boolean) => ({
  finalText: 'Listo, cerré tu viaje',
  toolCalls: [{ toolName: 'guardar_liquidacion', args: {}, result: { liquidacion_id: 'L1', pdf_generado }, durationMs: 5 }],
  model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0,
});

beforeEach(() => {
  salientes.length = 0; media.clear();
  runAgent.mockReset(); createSignedUrl.mockReset();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  getOpenViaje.mockReset(); getOpenViaje.mockResolvedValue('v1');
  claimMessage.mockReset(); claimMessage.mockResolvedValue('nuevo');
  saveCfdiXmlRaw.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
});

describe('cierre sin PDF: ni se manda un documento que no existe, ni se calla', () => {
  beforeEach(() => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/liq.pdf' }, error: null });
  });

  it('con pdf_generado=true manda el documento (control: sin esto lo de abajo no prueba nada)', async () => {
    runAgent.mockResolvedValue(cierre(true));
    await processInbound(listo);
    expect(documentos()).toHaveLength(1);
  });

  // Con el cliente real, este `to` es el que de verdad viaja a Meta. Con el
  // espía se veía igual el número que rebota que el que se acepta (M1b).
  it('y lo manda al número que Meta acepta, no al que Meta entregó', async () => {
    runAgent.mockResolvedValue(cierre(true));
    await processInbound(listo);
    expect(documentos()[0].body.to).toBe('529993700779');
    expect(documentos()[0].body.to).not.toBe(listo.from);
  });

  it('con pdf_generado=false NO pide una URL de un objeto que no existe', async () => {
    runAgent.mockResolvedValue(cierre(false));
    await processInbound(listo);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(documentos()).toHaveLength(0);
  });

  it('con pdf_generado=false deja rastro en el log — antes no había ni una línea', async () => {
    runAgent.mockResolvedValue(cierre(false));
    await processInbound(listo);
    expect(logger.error).toHaveBeenCalledWith('pdf.no_entregado', expect.objectContaining({ viaje: 'v1', pdfGenerado: false }));
  });

  it('con pdf_generado=false se lo dice al operador, en vez de dejarlo esperando', async () => {
    runAgent.mockResolvedValue(cierre(false));
    await processInbound(listo);
    expect(textos().join('\n')).toMatch(/no pude generarte el PDF|panel/i);
  });

  it('si storage falla al firmar, tampoco se calla', async () => {
    runAgent.mockResolvedValue(cierre(true));
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    await processInbound(listo);
    expect(documentos()).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith('pdf.no_entregado', expect.objectContaining({ err: 'Object not found' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el producto pedía el XML y luego se negaba a recibirlo.
//
// `complemento_no_verificable` no está en SOLO_CONTRALOR a propósito: su nota le
// dice al operador "reenvía el XML (el que te manda la gasolinera por correo)".
// Ese texto llega en el MISMO mensaje de cierre, cuando guardar_liquidacion ya
// puso el viaje en 'liquidado'.
//
// El operador obedecía, el corte por "sin viaje abierto" lo mandaba de vuelta, y
// el XML se descartaba SIN GUARDARSE EN NINGÚN LADO. Con él se va el
// acreditamiento de IVA de ese CFDI y los litros que alimentan el estímulo del
// LIF 20-A. Mismo error que ya se corrigió para el medio ARCO: se arregló el caso
// y no la clase.
// ═══════════════════════════════════════════════════════════════════════════
describe('el XML que llega después del cierre no se pierde', () => {
  const xmlDoc = { from: '5219993700779', type: 'document' as const, mediaId: 'm1', waMessageId: 'wa9' };

  // El XML ya no se le sirve al processor desde un espía: se descarga por el
  // camino real (`downloadMediaAsText` → metadatos → contenido), y este mapa es
  // lo que Meta tendría del otro lado.
  beforeEach(() => { getOpenViaje.mockResolvedValue(null); media.set('m1', '<cfdi/>'); });

  it('sin viaje abierto, el XML se conserva por UUID en vez de descartarse', async () => {
    await processInbound(xmlDoc);
    expect(saveCfdiXmlRaw).toHaveBeenCalledWith('t1', 'uuid-abc', null, '<cfdi/>');
  });

  it('y se le dice al operador que sí llegó, no "no tienes viaje abierto"', async () => {
    await processInbound(xmlDoc);
    const dicho = textos().join('\n');
    expect(dicho).toMatch(/Recib.* tu XML/i);
    expect(dicho).not.toMatch(/No tienes un viaje abierto/i);
  });

  // Si la descarga del media falla —el token de WhatsApp vencido el 28-jul—, el
  // XML no existe y NO se puede afirmar que se guardó. Este caso no se podía
  // probar con el espía: `downloadMediaAsText` devolvía lo que el test quisiera.
  it('si Meta no entrega el media, no se inventa un XML guardado', async () => {
    media.delete('m1');
    await processInbound(xmlDoc);
    expect(saveCfdiXmlRaw).not.toHaveBeenCalled();
    expect(textos().join('\n')).toMatch(/No tienes un viaje abierto/i);
  });

  it('un TEXTO sin viaje abierto sigue recibiendo el mensaje de siempre (regresión)', async () => {
    await processInbound({ from: '5219993700779', type: 'text', text: 'hola', waMessageId: 'wa10' });
    expect(textos().join('\n')).toMatch(/No tienes un viaje abierto/i);
    expect(saveCfdiXmlRaw).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el fail-closed del claim se apoyaba en un retry inexistente.
//
// `claimMessage` trataba CUALQUIER error de DB como duplicado, con el argumento
// escrito de que "el retry de Meta lo reprocesará cuando la DB responda". Ese
// retry no existe: `route.ts` responde 200 y trabaja en `after()`, así que Meta
// ya tiene su acuse y no reintenta nunca.
//
// Un blip de Supabase en el insert —pool agotado, 503, timeout— y el "listo" del
// operador desaparecía para siempre: cero mensajes salientes, y un log de nivel
// info que encima mentía llamándolo duplicado. A las 3 a.m. nadie encuentra eso.
// ═══════════════════════════════════════════════════════════════════════════
describe('un claim que no se pudo determinar no puede tragarse el mensaje', () => {
  beforeEach(() => {
    runAgent.mockResolvedValue({ finalText: 'Listo', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  });

  it('un DUPLICADO de verdad se sigue descartando', async () => {
    claimMessage.mockResolvedValue('duplicado');
    await processInbound(listo);
    expect(runAgent).not.toHaveBeenCalled();
    expect(salientes, 'salió un mensaje por un duplicado').toHaveLength(0);
  });

  it('un INDETERMINADO se procesa: perder el mensaje es peor que reprocesarlo', async () => {
    claimMessage.mockResolvedValue('indeterminado');
    await processInbound(listo);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(textos().length).toBeGreaterThan(0);
  });

  it('y queda anotado como lo que es, no como un duplicado', async () => {
    claimMessage.mockResolvedValue('indeterminado');
    await processInbound(listo);
    expect(logger.warn).toHaveBeenCalledWith('wa.claim_indeterminado', expect.objectContaining({ id: 'wa1' }));
    expect(logger.info).not.toHaveBeenCalledWith('wa.duplicate', expect.anything());
  });
});
