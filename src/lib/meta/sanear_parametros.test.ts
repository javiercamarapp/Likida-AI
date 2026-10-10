import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA OLA 1, #25 — ERROR 132018 DE META: un parámetro de plantilla con
// saltos de línea, tabuladores o más de 4 espacios seguidos se rechaza, y es un
// código TERMINAL (la fila queda `dead`). La alerta de colisión por cámara al
// jefe (gps_alerta_critica) mandaba su cuerpo con «\n\n» crudo.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const encolarDedupe = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ id: 'o-1', estado: 'pending' })));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/wa_outbox', () => ({
  encolarSalidaWhatsApp: vi.fn(), encolarSalidaWhatsAppDedupe: encolarDedupe, RETRASO_AMBIGUO_SEGUNDOS: 300,
}));

import { sanearPayloadWhatsApp } from './plantilla_payload';
const { encolarBotonesWhatsApp, enviarRespuestaArco } = await import('./client');

const SIN_BLANCOS_PROHIBIDOS = (t: string) => !/[\n\r\t]/.test(t) && !/ {2,}/.test(t);

describe('sanearPayloadWhatsApp', () => {
  const plantilla = (texto: string) => ({
    messaging_product: 'whatsapp', to: '1', type: 'template',
    template: { name: 'x', language: { code: 'es_MX' }, components: [
      { type: 'header', parameters: [{ type: 'text', text: texto }] },
      { type: 'body', parameters: [{ type: 'text', text: texto }, { type: 'text', text: 'ok' }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'a\nb' }] },
    ] },
  });

  it('aplana \\n, \\r\\n, tabs y espacios repetidos en header y body', () => {
    const r = sanearPayloadWhatsApp(plantilla('a\n\nb\r\nc\td      e')) as ReturnType<typeof plantilla>;
    expect(r.template.components[0].parameters[0]).toEqual({ type: 'text', text: 'a b c d e' });
    expect((r.template.components[1].parameters as Array<{ text: string }>)[0].text).toBe('a b c d e');
    expect((r.template.components[1].parameters as Array<{ text: string }>)[1].text).toBe('ok');
  });
  it('NO toca el payload de un botón ni muta el original', () => {
    const original = plantilla('x\ny');
    const r = sanearPayloadWhatsApp(original) as ReturnType<typeof plantilla>;
    expect((r.template.components[2].parameters as Array<{ payload: string }>)[0].payload).toBe('a\nb');
    expect((original.template.components[0].parameters as Array<{ text: string }>)[0].text).toBe('x\ny');
  });
  it('un mensaje que no es plantilla (texto libre, interactivo) pasa idéntico', () => {
    const texto = { messaging_product: 'whatsapp', type: 'text', text: { body: 'línea 1\n\nlínea 2' } };
    expect(sanearPayloadWhatsApp(texto)).toBe(texto);
    const inter = { type: 'interactive', interactive: { body: { text: 'a\nb' } } };
    expect(sanearPayloadWhatsApp(inter)).toBe(inter);
  });
  it('entradas raras no truenan', () => {
    expect(sanearPayloadWhatsApp(null)).toBeNull();
    expect(sanearPayloadWhatsApp(undefined)).toBeUndefined();
    expect(sanearPayloadWhatsApp('x')).toBe('x');
    expect(sanearPayloadWhatsApp({ type: 'template' })).toEqual({ type: 'template' });
    expect(sanearPayloadWhatsApp({ type: 'template', template: { components: [null, 3, { type: 'body' }] } }))
      .toEqual({ type: 'template', template: { components: [null, 3, { type: 'body' }] } });
  });
  it('es idempotente', () => {
    const una = sanearPayloadWhatsApp(plantilla('a\n\nb'));
    expect(sanearPayloadWhatsApp(una)).toEqual(una);
  });
});

describe('encolarBotonesWhatsApp (gps_alerta_critica)', () => {
  beforeEach(() => { encolarDedupe.mockClear(); Object.values(logger).forEach((f) => f.mockReset()); });

  const CUERPO_REAL =
    '🚨 La cámara de ECO-114 detectó una POSIBLE COLISIÓN en el viaje F-9 (colision, frenado).\n\n' +
    'Tu chofer NO ha reportado nada por aquí todavía — puede que no pueda. MÁRCALE AHORA, y el video está en tu panel del proveedor: https://x.test/v/1.' +
    '\n\nAprieta el botón para que sepamos que ya lo estás atendiendo.';

  it('el cuerpo real de la alerta de colisión sale SIN saltos de línea (el caso del hallazgo)', async () => {
    const r = await encolarBotonesWhatsApp('5219993700779', CUERPO_REAL, [{ id: 'asi_ok:7', titulo: 'Ya lo atiendo' }], 'gps:x:t:1');
    expect(r).not.toBeNull();
    const [dedupe, payload] = encolarDedupe.mock.calls[0] as unknown as [string, { template: { name: string; components: Array<{ parameters: Array<Record<string, string>> }> } }];
    expect(dedupe).toBe('gps:x:t:1');
    expect(payload.template.name).toBe('gps_alerta_critica');
    const texto = payload.template.components[0].parameters[0].text;
    expect(SIN_BLANCOS_PROHIBIDOS(texto)).toBe(true);
    expect(texto).toContain('POSIBLE COLISIÓN');
    expect(texto).toContain('https://x.test/v/1.');
    // el botón conserva el acuse
    expect(payload.template.components[1].parameters[0].payload).toBe('asi_ok:7');
  });
  it('tabs y cuatro+ espacios también se aplanan', async () => {
    await encolarBotonesWhatsApp('5219993700779', 'a\tb      c\r\nd', [{ id: 'x', titulo: 'Ok' }], 'gps:y');
    const payload = encolarDedupe.mock.calls[0][1] as { template: { components: Array<{ parameters: Array<Record<string, string>> }> } };
    expect(payload.template.components[0].parameters[0].text).toBe('a b c d');
  });
  it('un cuerpo que es solo blancos no se encola (Meta lo rechazaría)', async () => {
    const r = await encolarBotonesWhatsApp('5219993700779', ' \n\t ', [{ id: 'x', titulo: 'Ok' }], 'gps:z');
    expect(r).toBeNull();
    expect(encolarDedupe).not.toHaveBeenCalled();
  });
});

describe('enviarRespuestaArco fuera de la ventana de 24 h', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131047 } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'wamid.A' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('la plantilla respuesta_arco_v2 lleva la respuesta aplanada', async () => {
    const r = await enviarRespuestaArco('5219993700779', 'Hola.\n\nTu solicitud fue atendida.\n\n- Punto 1\n- Punto 2');
    expect(r.ok).toBe(true);
    const cuerpo = JSON.parse(String((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body));
    const params = cuerpo.template.components[0].parameters as Array<{ text: string }>;
    expect(params[1].text).toBe('Hola. Tu solicitud fue atendida. - Punto 1 - Punto 2');
    expect(SIN_BLANCOS_PROHIBIDOS(params[1].text)).toBe(true);
  });
});
