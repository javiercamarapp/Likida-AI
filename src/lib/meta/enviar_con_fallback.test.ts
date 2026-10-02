import { describe, it, expect, vi, beforeEach } from 'vitest';

// El selector central: texto/botones con ventana abierta, plantilla con ventana
// cerrada, y el motivo de cada decisión. Los envíos y la caché de ventana se
// simulan con los contratos reales de client.ts (`{ok,id}` / `{ok:false,codigo,status}`).

const enviarTexto = vi.hoisted(() => vi.fn());
const enviarBotones = vi.hoisted(() => vi.fn());
const sendTemplate = vi.hoisted(() => vi.fn());
vi.mock('./client', async () => {
  // Las dos funciones puras se toman del módulo real (su contrato es el que usa el selector).
  const real = await vi.importActual<typeof import('./client')>('./client');
  return { ...real, enviarTexto, enviarBotones, sendTemplate };
});
const ventanaDeContacto = vi.hoisted(() => vi.fn());
const registrarDecisionEnvio = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@/lib/likida/wa_ventana', () => ({ ventanaDeContacto, registrarDecisionEnvio }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

const { enviarConFallback, esFueraDeVentana, CODIGOS_FUERA_VENTANA } = await import('./enviar_con_fallback');

const TEL = '5219993700779';
const PLANTILLA = { nombre: 'aviso_operacion_v1', parametros: ['a', 'b', 'c'] };
const OP = { texto: 'hola jefe', plantilla: PLANTILLA, contexto: 'prueba', tenantId: 't-1' };
const ventana = (estado: 'abierta' | 'cerrada' | 'desconocida') => ventanaDeContacto.mockResolvedValue({ estado, ultimoEntranteEn: null, expiraEn: null });
const OK = (id = 'wamid.OK') => ({ ok: true as const, id });
const KO = (codigo?: number, status?: number, error = 'rechazo') => ({ ok: false as const, error, codigo, status });

beforeEach(() => {
  [enviarTexto, enviarBotones, sendTemplate, ventanaDeContacto, registrarDecisionEnvio, ...Object.values(logger)].forEach((f) => f.mockReset());
  enviarTexto.mockResolvedValue(OK()); enviarBotones.mockResolvedValue(OK('wamid.BTN')); sendTemplate.mockResolvedValue(OK('wamid.TPL'));
  registrarDecisionEnvio.mockResolvedValue(undefined);
});

describe('ventana ABIERTA', () => {
  it('manda el texto, no toca la plantilla y registra el motivo', async () => {
    ventana('abierta');
    const r = await enviarConFallback(TEL, OP);
    expect(r).toEqual({ ok: true, via: 'texto', id: 'wamid.OK', motivo: 'ventana_abierta', ventana: 'abierta' });
    expect(enviarTexto).toHaveBeenCalledWith(TEL, 'hola jefe');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(registrarDecisionEnvio).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', contexto: 'prueba', telefono: TEL, ventana: 'abierta', canal: 'texto', motivo: 'ventana_abierta', ok: true, plantilla: null,
    }));
  });

  it('con botones, salen como botones', async () => {
    ventana('abierta');
    const r = await enviarConFallback(TEL, { ...OP, botones: [{ id: 'si', titulo: 'Sí' }] });
    expect(r).toMatchObject({ ok: true, via: 'botones', id: 'wamid.BTN' });
    expect(enviarBotones).toHaveBeenCalledWith(TEL, 'hola jefe', [{ id: 'si', titulo: 'Sí' }]);
    expect(enviarTexto).not.toHaveBeenCalled();
  });

  it('el registro estaba viejo: Meta rechaza por ventana (131047) → cae a plantilla', async () => {
    ventana('abierta');
    enviarTexto.mockResolvedValue(KO(131047, 400));
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: true, via: 'plantilla', id: 'wamid.TPL', motivo: 'ventana_abierta_rechazada_por_meta' });
    expect(sendTemplate).toHaveBeenCalledWith(TEL, 'aviso_operacion_v1', { idioma: undefined, parametros: ['a', 'b', 'c'] });
  });

  it('botones rechazados por ventana → plantilla (con el código, no un null mudo)', async () => {
    ventana('abierta');
    enviarBotones.mockResolvedValue(KO(131047, 400));
    const r = await enviarConFallback(TEL, { ...OP, botones: [{ id: 'si', titulo: 'Sí' }] });
    expect(r).toMatchObject({ ok: true, via: 'plantilla' });
  });
});

describe('ventana DESCONOCIDA (contacto sin registro): se comporta como avisarOficina de siempre', () => {
  it('texto OK', async () => {
    ventana('desconocida');
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: true, via: 'texto', motivo: 'ventana_desconocida' });
    expect(sendTemplate).not.toHaveBeenCalled();
  });
  it.each(CODIGOS_FUERA_VENTANA)('texto rechazado con %i → plantilla', async (codigo) => {
    ventana('desconocida');
    enviarTexto.mockResolvedValue(KO(codigo, 400));
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: true, via: 'plantilla', motivo: 'ventana_desconocida_rechazada_por_meta' });
  });
});

describe('ventana CERRADA', () => {
  it('va directo a la plantilla: ni intenta el texto que Meta rechazaría', async () => {
    ventana('cerrada');
    const r = await enviarConFallback(TEL, { ...OP, plantilla: { ...PLANTILLA, idioma: 'es' } });
    expect(r).toMatchObject({ ok: true, via: 'plantilla', motivo: 'ventana_cerrada', ventana: 'cerrada' });
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalledWith(TEL, 'aviso_operacion_v1', { idioma: 'es', parametros: ['a', 'b', 'c'] });
    expect(registrarDecisionEnvio).toHaveBeenCalledWith(expect.objectContaining({ canal: 'plantilla', plantilla: 'aviso_operacion_v1', ventana: 'cerrada' }));
  });

  it('la plantilla pasa encabezado y botones tal cual', async () => {
    ventana('cerrada');
    const plantilla = {
      nombre: 'conductor_recordatorio_1_v1', parametros: ['Juan', 'tu llegada', 'F-1'],
      botones: [{ tipo: 'respuesta_rapida' as const, indice: 0, payload: 'recordatorio_registrar:v1' }],
      encabezado: { tipo: 'texto' as const, texto: 'Aviso' },
    };
    await enviarConFallback(TEL, { ...OP, plantilla });
    expect(sendTemplate).toHaveBeenCalledWith(TEL, 'conductor_recordatorio_1_v1', expect.objectContaining({ botones: plantilla.botones, encabezado: plantilla.encabezado }));
  });

  it('plantilla NO aprobada (132001) y el registro pudo estar viejo: último recurso, el texto', async () => {
    ventana('cerrada');
    sendTemplate.mockResolvedValue({ ok: false, error: 'no aprobada', codigo: 132001 });
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: true, via: 'texto', motivo: 'ventana_cerrada_plantilla_no_aprobada_texto' });
  });

  it('plantilla no aprobada y el texto también rebota: falla diciendo QUÉ arreglar', async () => {
    ventana('cerrada');
    sendTemplate.mockResolvedValue({ ok: false, error: 'no aprobada', codigo: 132001 });
    enviarTexto.mockResolvedValue(KO(131047, 400));
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: false, motivo: 'plantilla_rechazada', codigo: 132001, fueraDeVentana: true, reintentable: false });
    expect(!r.ok && r.mensaje).toMatch(/plantilla no está aprobada/);
    expect(registrarDecisionEnvio).toHaveBeenCalledWith(expect.objectContaining({ canal: 'ninguno', ok: false, codigoMeta: 132001 }));
  });

  it('plantilla con rate limit (130429): reintentable, y NO se prueba el texto (ya quedó en el outbox)', async () => {
    ventana('cerrada');
    sendTemplate.mockResolvedValue({ ok: false, error: 'limit', codigo: 130429 });
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: false, reintentable: true });
    expect(enviarTexto).not.toHaveBeenCalled();
  });
});

describe('rechazos que NO son de ventana: nunca caen a plantilla (duplicaría lo ya encolado)', () => {
  it('429 del texto: reintentable, sin plantilla', async () => {
    ventana('abierta');
    enviarTexto.mockResolvedValue(KO(undefined, 429));
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: false, motivo: 'rechazo_no_ventana', reintentable: true, fueraDeVentana: false, status: 429 });
    expect(sendTemplate).not.toHaveBeenCalled();
  });
  it('bloqueo temporal 133016: reintentable, sin plantilla', async () => {
    ventana('desconocida');
    enviarTexto.mockResolvedValue(KO(133016, 400));
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: false, reintentable: true });
    expect(sendTemplate).not.toHaveBeenCalled();
  });
  it('número fuera de la lista de pruebas (131030): no reintentable, con el motivo en palabras', async () => {
    ventana('abierta');
    enviarTexto.mockResolvedValue(KO(131030, 400));
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: false, reintentable: false, fueraDeVentana: false, codigo: 131030 });
    expect(!r.ok && r.mensaje).toMatch(/lista de pruebas/);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
  it('error de red del texto (status 503 sin código): reintentable', async () => {
    ventana('abierta');
    enviarTexto.mockResolvedValue(KO(undefined, 503, 'No se pudo contactar a WhatsApp: x'));
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: false, reintentable: true, mensaje: 'No se pudo contactar a WhatsApp: x' });
  });
});

describe('ventana rechazada y la plantilla además da 429', () => {
  it('reintentable (la plantilla quedó en el outbox por sendTemplate)', async () => {
    ventana('desconocida');
    enviarTexto.mockResolvedValue(KO(131047, 400));
    sendTemplate.mockResolvedValue({ ok: false, error: 'limit', codigo: 130429 });
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: false, fueraDeVentana: true, reintentable: true, codigoTexto: 131047, codigo: 130429 });
  });
});

describe('ADVERSARIAL 07: lo que el cliente de Meta YA encoló (`encolado`) aunque no sea «reintentable»', () => {
  it('plantilla con timeout de red (status 503 de sendTemplate): reintentable y encolado', async () => {
    ventana('cerrada');
    sendTemplate.mockResolvedValue({ ok: false, error: 'No se pudo contactar a WhatsApp: x', status: 503 });
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: false, reintentable: true, encolado: true });
  });
  it('plantilla con HTTP 503 y código no listado: reintentable y encolado', async () => {
    ventana('cerrada');
    sendTemplate.mockResolvedValue({ ok: false, error: 'x', codigo: 2, status: 503 });
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: false, reintentable: true, encolado: true });
  });
  it('token vencido (190) en la plantilla: NO es reintentable, pero SÍ quedó encolado', async () => {
    ventana('cerrada');
    sendTemplate.mockResolvedValue({ ok: false, error: 'token', codigo: 190, status: 401 });
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: false, reintentable: false, encolado: true });
  });
  it('token vencido (190) en el texto: NO es reintentable, pero SÍ quedó encolado', async () => {
    ventana('abierta');
    enviarTexto.mockResolvedValue(KO(190, 401, 'token'));
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: false, reintentable: false, encolado: true });
  });
  it('plantilla sin aprobar (132001): definitivo y NO encolado (reintentar es gratis)', async () => {
    ventana('cerrada');
    enviarTexto.mockResolvedValue(KO(131047, 400));
    sendTemplate.mockResolvedValue({ ok: false, error: 'no aprobada', codigo: 132001, status: 400 });
    expect(await enviarConFallback(TEL, OP)).toMatchObject({ ok: false, reintentable: false, encolado: false });
  });
});

describe('robustez', () => {
  it('si un envío lanza (p. ej. falta WHATSAPP_ACCESS_TOKEN), devuelve ok:false y no lanza', async () => {
    ventana('abierta');
    enviarTexto.mockRejectedValue(new Error('WHATSAPP_ACCESS_TOKEN no configurado'));
    const r = await enviarConFallback(TEL, OP);
    expect(r).toMatchObject({ ok: false, mensaje: 'WHATSAPP_ACCESS_TOKEN no configurado', reintentable: false });
    expect(logger.error).toHaveBeenCalled();
  });
  it('el log de la decisión no lleva el teléfono completo', async () => {
    ventana('cerrada');
    await enviarConFallback(TEL, OP);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('9993700779');
  });
  it('esFueraDeVentana', () => {
    expect(esFueraDeVentana(131047)).toBe(true);
    expect(esFueraDeVentana(131026)).toBe(true);
    expect(esFueraDeVentana(131042)).toBe(true);
    expect(esFueraDeVentana(132001)).toBe(false);
    expect(esFueraDeVentana(undefined)).toBe(false);
  });
  it('no duplica: una sola llamada de texto y una de plantilla por aviso, aunque se invoque dos veces con la misma ventana cerrada → 2 plantillas (dos avisos distintos)', async () => {
    ventana('cerrada');
    await enviarConFallback(TEL, OP);
    await enviarConFallback(TEL, OP);
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(enviarTexto).not.toHaveBeenCalled();
  });
});

describe('documento en el encabezado (liquidación externa)', () => {
  const DOC = { url: 'https://storage.example/liq.pdf?t=1', nombreArchivo: 'liquidacion-1.pdf' };
  const BOT = [{ id: 'liqext_ok:1', titulo: 'Recibida' }, { id: 'liqext_no:1', titulo: 'No coincide' }];

  it('ventana abierta: los botones salen CON el documento en el encabezado', async () => {
    ventana('abierta');
    const r = await enviarConFallback(TEL, { ...OP, botones: BOT, documento: DOC });
    expect(r).toMatchObject({ ok: true, via: 'botones' });
    expect(enviarBotones).toHaveBeenCalledWith(TEL, 'hola jefe', BOT, DOC);
  });

  it('ventana cerrada: la plantilla lleva el MISMO documento en su encabezado', async () => {
    ventana('cerrada');
    await enviarConFallback(TEL, { ...OP, botones: BOT, documento: DOC });
    expect(sendTemplate).toHaveBeenCalledWith(TEL, 'aviso_operacion_v1', expect.objectContaining({
      encabezado: { tipo: 'documento', link: DOC.url, nombreArchivo: DOC.nombreArchivo },
    }));
    expect(enviarBotones).not.toHaveBeenCalled();
  });

  it('un encabezado propio de la plantilla no se pisa con el documento', async () => {
    ventana('cerrada');
    const propio = { tipo: 'documento' as const, link: 'https://otro.example/a.pdf' };
    await enviarConFallback(TEL, { ...OP, plantilla: { ...PLANTILLA, encabezado: propio }, botones: BOT, documento: DOC });
    expect(sendTemplate).toHaveBeenCalledWith(TEL, 'aviso_operacion_v1', expect.objectContaining({ encabezado: propio }));
  });

  it('ventana abierta pero Meta dice 131047: cae a plantilla con el documento', async () => {
    ventana('abierta');
    enviarBotones.mockResolvedValue(KO(131047, 400));
    const r = await enviarConFallback(TEL, { ...OP, botones: BOT, documento: DOC });
    expect(r).toMatchObject({ ok: true, via: 'plantilla', motivo: 'ventana_abierta_rechazada_por_meta' });
    expect(sendTemplate).toHaveBeenCalledWith(TEL, 'aviso_operacion_v1', expect.objectContaining({
      encabezado: expect.objectContaining({ tipo: 'documento', link: DOC.url }),
    }));
  });
});

// ── modo durable (por la cola wa_outbox) ───────────────────────────────────
describe('enviarConFallbackDurable', () => {
  const DOC = { url: 'https://storage.example/liq.pdf?t=1', nombreArchivo: 'liquidacion-1.pdf' };
  const BOT = [{ id: 'liqext_ok:1', titulo: 'Recibida' }, { id: 'liqext_no:1', titulo: 'No coincide' }];
  const OPD = { ...OP, botones: BOT, documento: DOC, llave: 'liqext:1:g1', plantilla: { nombre: 'liquidacion_externa_v1', parametros: ['Juan'] } };
  type Fila = { dedupe_key: string; estado: 'pending' | 'sending' | 'sent' | 'dead'; provider_message_id: string | null; ultimo_error: string | null };
  const cola = new Map<string, Fila>();
  const encolados: Array<{ llave: string; payload: Record<string, unknown> }> = [];
  let lecturaFalla = false;
  let colaCaida = false;

  beforeEach(async () => {
    cola.clear(); encolados.length = 0; lecturaFalla = false; colaCaida = false;
    const wo = await import('@/lib/likida/wa_outbox');
    vi.spyOn(wo, 'leerSalidasPorLlave').mockImplementation(async (llaves: string[]) => (
      lecturaFalla ? null : new Map(llaves.filter((l) => cola.has(l)).map((l) => [l, cola.get(l)!]))
    ));
    vi.spyOn(wo, 'encolarSalidaWhatsAppDedupe').mockImplementation(async (llave: string, payload: Record<string, unknown>) => {
      if (colaCaida) return null;
      const previa = cola.get(llave);
      if (previa) return { id: llave, estado: previa.estado, providerMessageId: previa.provider_message_id };
      encolados.push({ llave, payload });
      cola.set(llave, { dedupe_key: llave, estado: 'pending', provider_message_id: null, ultimo_error: null });
      return { id: llave, estado: 'pending', providerMessageId: null };
    });
  });

  it('ventana abierta o desconocida: encola la SESIÓN (botones con documento) y no llama a Meta', async () => {
    const { enviarConFallbackDurable } = await import('./enviar_con_fallback');
    for (const est of ['abierta', 'desconocida'] as const) {
      cola.clear(); encolados.length = 0; ventana(est);
      expect(await enviarConFallbackDurable(TEL, OPD)).toMatchObject({ estado: 'en_cola', via: 'sesion' });
      expect(encolados.map((e) => e.llave)).toEqual(['liqext:1:g1:sesion']);
      expect((encolados[0].payload as { interactive: { header: { type: string } } }).interactive.header.type).toBe('document');
    }
    expect(enviarBotones).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('ventana cerrada: encola DIRECTO la plantilla con el documento en el encabezado', async () => {
    const { enviarConFallbackDurable } = await import('./enviar_con_fallback');
    ventana('cerrada');
    expect(await enviarConFallbackDurable(TEL, OPD)).toMatchObject({ estado: 'en_cola', via: 'plantilla' });
    expect(encolados.map((e) => e.llave)).toEqual(['liqext:1:g1:plantilla']);
    const comps = (encolados[0].payload as { template: { components: Array<{ type: string; parameters: Array<{ type: string }> }> } }).template.components;
    expect(comps[0].type).toBe('header');
    expect(comps[0].parameters[0].type).toBe('document');
    expect(registrarDecisionEnvio).toHaveBeenCalledWith(expect.objectContaining({ canal: 'plantilla', motivo: 'ventana_cerrada', plantilla: 'liquidacion_externa_v1' }));
  });

  it('idempotente: dos llamadas (y dos concurrentes) dejan UNA sola fila', async () => {
    const { enviarConFallbackDurable } = await import('./enviar_con_fallback');
    ventana('abierta');
    await Promise.all([enviarConFallbackDurable(TEL, OPD), enviarConFallbackDurable(TEL, OPD)]);
    await enviarConFallbackDurable(TEL, OPD);
    expect(encolados).toHaveLength(1);
  });

  it('sesión muerta por 131047 → plantilla UNA vez; muerta por otra causa → fallida sin plantilla', async () => {
    const { enviarConFallbackDurable } = await import('./enviar_con_fallback');
    ventana('abierta');
    await enviarConFallbackDurable(TEL, OPD);
    cola.set('liqext:1:g1:sesion', { dedupe_key: 'liqext:1:g1:sesion', estado: 'dead', provider_message_id: null, ultimo_error: 'terminal:HTTP 400: {"error":{"code":131047}}' });
    expect(await enviarConFallbackDurable(TEL, OPD)).toMatchObject({ estado: 'en_cola', via: 'plantilla' });
    await enviarConFallbackDurable(TEL, OPD);
    expect(encolados.filter((e) => e.llave.endsWith(':plantilla'))).toHaveLength(1);

    cola.clear(); encolados.length = 0;
    await enviarConFallbackDurable(TEL, OPD);
    cola.set('liqext:1:g1:sesion', { dedupe_key: 'liqext:1:g1:sesion', estado: 'dead', provider_message_id: null, ultimo_error: 'terminal:131030' });
    expect(await enviarConFallbackDurable(TEL, OPD)).toMatchObject({ estado: 'fallida', via: 'sesion', reintentable: false });
    expect(encolados).toHaveLength(1);
  });

  it('el outbox ilegible o caído es reintentable y no encola a ciegas; un documento no https ni se encola', async () => {
    const { enviarConFallbackDurable } = await import('./enviar_con_fallback');
    ventana('abierta');
    lecturaFalla = true;
    expect(await enviarConFallbackDurable(TEL, OPD)).toMatchObject({ estado: 'fallida', reintentable: true });
    lecturaFalla = false; colaCaida = true;
    expect(await enviarConFallbackDurable(TEL, OPD)).toMatchObject({ estado: 'fallida', reintentable: true });
    colaCaida = false;
    expect(await enviarConFallbackDurable(TEL, { ...OPD, documento: { ...DOC, url: 'http://x.example/a.pdf' } })).toMatchObject({ estado: 'fallida', reintentable: false });
    expect(encolados).toHaveLength(0);
  });
});
