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
