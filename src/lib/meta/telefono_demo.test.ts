// ═══════════════════════════════════════════════════════════════════════════
// El tenant demo NUNCA escribe a nadie. Sus teléfonos llevan una marca explícita (28999…: el código de país 289 no
// está asignado a ningún país, así que ningún número real empieza así) y TODO camino que llama a la Graph API la
// rechaza antes de hacer la llamada. Estas pruebas miran lo que sale hacia la red: cero llamadas.
// ═══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enviarBotones, enviarRespuestaArco, enviarSolicitudUbicacion, enviarTexto, encolarBotonesWhatsApp, sendDocument, sendTemplate,
} from './client';
import { esTelefonoDemo, PREFIJO_TELEFONO_DEMO } from './telefono_demo';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/wa_outbox', () => ({
  encolarSalidaWhatsApp: vi.fn(async () => undefined),
  encolarSalidaWhatsAppDedupe: vi.fn(async () => ({ id: 'x', estado: 'pending', providerMessageId: null })),
  RETRASO_AMBIGUO_SEGUNDOS: 5,
}));

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('esTelefonoDemo', () => {
  it('reconoce la marca con cualquier formato de escritura', () => {
    for (const t of ['28999900000001', '+28999900000001', '289999 0000 0001', '28999-90-0000', `${PREFIJO_TELEFONO_DEMO}1234567`]) expect(esTelefonoDemo(t), t).toBe(true);
  });
  it('no confunde un teléfono real', () => {
    for (const t of ['5219993700779', '529993700779', '5215559500001', '+14155550100', '', '2899', '2889912345678']) expect(esTelefonoDemo(t), t).toBe(false);
  });
  it('el prefijo no es de ningún país (código 289 sin asignar) ni cabe como número mexicano', () => {
    expect(PREFIJO_TELEFONO_DEMO.startsWith('289')).toBe(true);
    expect(PREFIJO_TELEFONO_DEMO.startsWith('52')).toBe(false);
  });
});

const DEMO = '28999900000001';

describe('ningún camino de envío llama a Meta con un teléfono demo', () => {
  it('enviarTexto', async () => {
    const r = await enviarTexto(DEMO, 'hola');
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('enviarBotones', async () => {
    const r = await enviarBotones(DEMO, 'hola', [{ id: 'a', titulo: 'Sí' }]);
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('enviarSolicitudUbicacion', async () => {
    expect((await enviarSolicitudUbicacion(DEMO, 'comparte tu ubicación')).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('sendTemplate', async () => {
    expect((await sendTemplate(DEMO, 'plantilla_x', { parametros: ['a'] })).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('sendDocument', async () => {
    expect((await sendDocument(DEMO, 'https://x.invalid/a.pdf', 'a.pdf')).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('enviarRespuestaArco', async () => {
    expect((await enviarRespuestaArco(DEMO, 'respuesta')).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('encolarBotonesWhatsApp: ni siquiera encola en el outbox', async () => {
    const { encolarSalidaWhatsAppDedupe } = await import('@/lib/likida/wa_outbox');
    expect(await encolarBotonesWhatsApp(DEMO, 'alerta', [{ id: 'a', titulo: 'Sí' }], 'k1')).toBeNull();
    expect(encolarSalidaWhatsAppDedupe).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('el error dice por qué (no es un fallo de Meta que se reintente)', async () => {
    const r = await enviarTexto(DEMO, 'hola');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/demo/i);
      expect(r.codigo).toBeUndefined();
      expect(r.status).not.toBe(429);
      expect(r.status).not.toBe(503);
    }
  });
  it('control: un teléfono real SÍ llega a la red (la guarda no apaga el envío)', async () => {
    const r = await enviarTexto('5219993700779', 'hola');
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
