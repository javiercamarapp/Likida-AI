import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// sendTemplate completo / enviarBotones / enviarSolicitudUbicacion: el JSON que
// se le entrega a `fetch` y lo que se encola para reintento.

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const encolar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/wa_outbox', () => ({
  encolarSalidaWhatsApp: encolar, encolarSalidaWhatsAppDedupe: vi.fn(), RETRASO_AMBIGUO_SEGUNDOS: 300,
}));

const { sendTemplate, enviarBotones, sendButtons, enviarSolicitudUbicacion } = await import('./client');

let fetchSpy: ReturnType<typeof vi.fn>;
const cuerpo = (n = 0) => JSON.parse(String((fetchSpy.mock.calls[n] as [string, RequestInit])[1].body));
const respuestaOk = () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
const respuestaError = (status: number, code: number, message = 'x') =>
  new Response(JSON.stringify({ error: { code, message } }), { status });

beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
  Object.values(logger).forEach((f) => f.mockReset());
  encolar.mockReset();
  fetchSpy = vi.fn(async () => respuestaOk());
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('sendTemplate: compatibilidad con el formato histórico', () => {
  it('solo parámetros de cuerpo, idioma es_MX por defecto, destinatario sin el 1 mexicano', async () => {
    const r = await sendTemplate('5219993700779', 'recordatorio_cierre', { parametros: ['Juan', 'F-1'] });
    expect(r).toEqual({ ok: true, id: 'wamid.X' });
    expect(cuerpo()).toEqual({
      messaging_product: 'whatsapp', to: '529993700779', type: 'template',
      template: {
        name: 'recordatorio_cierre', language: { code: 'es_MX' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Juan' }, { type: 'text', text: 'F-1' }] }],
      },
    });
  });
  it('sin parámetros no manda components', async () => {
    await sendTemplate('5219993700779', 'x');
    expect(cuerpo().template.components).toBeUndefined();
  });
});

describe('sendTemplate: encabezado, cuerpo y botones', () => {
  it('documento + cuerpo + respuesta rápida + URL', async () => {
    await sendTemplate('5219993700779', 'liq', {
      idioma: 'es',
      encabezado: { tipo: 'documento', link: 'https://x.test/l.pdf', nombreArchivo: 'l.pdf' },
      parametros: ['F-1'],
      botones: [
        { tipo: 'respuesta_rapida', indice: 0, payload: 'ok:v1' },
        { tipo: 'url', indice: 1, sufijo: 'v1' },
      ],
    });
    const t = cuerpo().template;
    expect(t.language.code).toBe('es');
    expect(t.components.map((c: { type: string }) => c.type)).toEqual(['header', 'body', 'button', 'button']);
    expect(t.components[0].parameters[0]).toEqual({ type: 'document', document: { link: 'https://x.test/l.pdf', filename: 'l.pdf' } });
  });

  it('una plantilla mal armada NO llega a Meta y dice por qué', async () => {
    const r = await sendTemplate('5219993700779', 'x', { parametros: [''] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/mal armada.*vacío/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(encolar).not.toHaveBeenCalled();
  });
});

describe('sendTemplate: fallos', () => {
  it('132001 (no aprobada): devuelve el código y NO encola (reintentar no la aprueba)', async () => {
    fetchSpy.mockResolvedValue(respuestaError(400, 132001, 'template not approved'));
    const r = await sendTemplate('5219993700779', 'x', { parametros: ['a'] });
    expect(r).toEqual({ ok: false, error: 'template not approved', codigo: 132001 });
    expect(encolar).not.toHaveBeenCalled();
  });
  it('429 reintentable: se encola con el mismo payload (con botones y todo)', async () => {
    fetchSpy.mockResolvedValue(respuestaError(429, 130429));
    await sendTemplate('5219993700779', 'x', { parametros: ['a'], botones: [{ tipo: 'respuesta_rapida', indice: 0, payload: 'p' }] });
    expect(encolar).toHaveBeenCalledTimes(1);
    const payload = encolar.mock.calls[0][0] as { template: { components: unknown[] } };
    expect(payload.template.components).toHaveLength(2);
  });
  it('timeout/red: se encola con el retraso AMBIGUO y no lanza', async () => {
    fetchSpy.mockRejectedValue(new Error('socket hang up'));
    const r = await sendTemplate('5219993700779', 'x', { parametros: ['a'] });
    expect(r.ok).toBe(false);
    expect(encolar).toHaveBeenCalledWith(expect.anything(), 'socket hang up', 300);
  });
});

describe('enviarBotones (sendButtons con el código de Meta)', () => {
  const B = [{ id: 'si', titulo: 'Sí' }];
  it('ok devuelve el wamid; sendButtons sigue devolviendo string|null', async () => {
    expect(await enviarBotones('5219993700779', '¿Listo?', B)).toEqual({ ok: true, id: 'wamid.X' });
    expect(await sendButtons('5219993700779', '¿Listo?', B)).toBe('wamid.X');
  });
  it('131047 devuelve el código (para que el selector caiga a plantilla) y no encola', async () => {
    fetchSpy.mockResolvedValue(respuestaError(400, 131047, 'Re-engagement'));
    const r = await enviarBotones('5219993700779', '¿Listo?', B);
    expect(r).toMatchObject({ ok: false, codigo: 131047, status: 400 });
    expect(encolar).not.toHaveBeenCalled();
    expect(await sendButtons('5219993700779', '¿Listo?', B)).toBeNull();
  });
  it('botones inválidos: ni llega a Meta', async () => {
    const r = await enviarBotones('5219993700779', 'x', [{ id: 'a', titulo: 'x'.repeat(21) }]);
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('enviarSolicitudUbicacion (interactivo, solo dentro de la ventana)', () => {
  it('arma location_request_message / send_location', async () => {
    const r = await enviarSolicitudUbicacion('5219993700779', ' ¿Dónde estás? ');
    expect(r).toEqual({ ok: true, id: 'wamid.X' });
    expect(cuerpo()).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '529993700779', type: 'interactive',
      interactive: { type: 'location_request_message', body: { text: '¿Dónde estás?' }, action: { name: 'send_location' } },
    });
  });
  it('cuerpo vacío o gigante: no sale', async () => {
    expect((await enviarSolicitudUbicacion('5219993700779', '  ')).ok).toBe(false);
    expect((await enviarSolicitudUbicacion('5219993700779', 'x'.repeat(1025))).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('fuera de ventana (131047): devuelve el código, no encola', async () => {
    fetchSpy.mockResolvedValue(respuestaError(400, 131047));
    expect(await enviarSolicitudUbicacion('5219993700779', 'hola')).toMatchObject({ ok: false, codigo: 131047 });
    expect(encolar).not.toHaveBeenCalled();
  });
  it('red caída: se encola con retraso ambiguo', async () => {
    fetchSpy.mockRejectedValue(new Error('boom'));
    expect(await enviarSolicitudUbicacion('5219993700779', 'hola')).toMatchObject({ ok: false, status: 503 });
    expect(encolar).toHaveBeenCalledWith(expect.anything(), 'boom', 300);
  });
});
