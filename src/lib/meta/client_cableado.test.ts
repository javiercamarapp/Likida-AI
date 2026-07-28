// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 · CRÍTICO — el bug de dinero de HOY se podía reintroducir tal cual.
//
// `destinatario.test.ts` ancla la FUNCIÓN PURA `destinatarioWhatsApp` con el caso
// medido contra la Graph API. El auditor dejó la función intacta y correcta, y
// solo quitó su LLAMADA en los dos sitios que envían (mutación M1b):
//
//     - to: destinatarioWhatsApp(to), type: 'text', …   (sendText,     client.ts:73)
//     + to: to,                       type: 'text', …
//     - to: destinatarioWhatsApp(to),                   (sendDocument, client.ts:98)
//     + to: to,
//
// Resultado: 628 pruebas verdes, `tsc` 0, `eslint` sin salida. Cero señal.
//
// Y el bug es EL de hoy: Meta entrega los mensajes con el "1" mexicano en el
// `wa_id` (`5219993700779`) y RECHAZA los envíos que lo lleven (#131030,
// "Recipient phone number not in allowed list"). El código contestaba al mismo
// `from` que recibía, así que la respuesta rebotaba con TODO operador mexicano
// —que es todo el mercado—, en silencio, con el webhook devolviendo 200 y
// `agent.run` en verde.
//
// El bug nunca estuvo en la función. Estuvo en que el call site no la usaba. Por
// eso estas pruebas no llaman `destinatarioWhatsApp`: llaman `sendText` y
// `sendDocument` y miran el JSON que sale hacia la Graph API.
//
// Dato colateral que el auditor midió: `src/lib/meta/client.ts` lo importaba UN
// solo test en toda la suite, y los dos del processor hacen `vi.mock` del módulo,
// así que el camino real de envío nunca se ejecutaba.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { sendText, sendDocument, verifySignature } from './client';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** El cuerpo JSON que se le mandó a la Graph API en la llamada `n`. */
function cuerpoEnviado(fetchSpy: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  const [, init] = fetchSpy.mock.calls[n] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  // Nunca sale de la máquina: se responde el 200 con el wamid que Meta devuelve.
  fetchSpy = vi.fn(async () => new Response(
    JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('el envío normaliza el destinatario mexicano (M1b: el cableado de HOY)', () => {
  it('sendText le escribe a 52999… aunque Meta lo haya entregado como 521999…', async () => {
    await sendText('5219993700779', 'Listo, cuadré tu viaje');
    expect(cuerpoEnviado(fetchSpy).to).toBe('529993700779');
  });

  it('sendDocument también: el PDF rebotaba igual que el texto', async () => {
    await sendDocument('5219993700779', 'https://x.test/l.pdf', 'liquidacion.pdf', 'Tu liquidación');
    expect(cuerpoEnviado(fetchSpy).to).toBe('529993700779');
  });

  // El caso REAL, tal cual llega del webhook: es el `from` de un mensaje entrante
  // de Meta el que trae el "1", así que el número que entra a `sendText` es
  // literalmente el que ella misma emitió.
  it('el número que Meta ENTREGA no es el número al que Meta ACEPTA que le escribas', async () => {
    const desdeElWebhook = '5219993700779';   // wa_id tal como lo manda Meta
    await sendText(desdeElWebhook, 'hola');
    expect(cuerpoEnviado(fetchSpy).to).not.toBe(desdeElWebhook);
    expect(cuerpoEnviado(fetchSpy).to).toBe('529993700779');
  });

  // CONTROL. Sin esto, "quitar el 1" podría implementarse mordiendo cualquier
  // número y las pruebas de arriba no lo notarían. El recorte es SOLO para la
  // forma 52 + 1 + diez dígitos: ninguna otra lada se toca.
  it('un número que NO es 52+1+10 dígitos pasa intacto', async () => {
    await sendText('+1 305 555 1234', 'hi');
    expect(cuerpoEnviado(fetchSpy).to).toBe('13055551234');
    fetchSpy.mockClear();
    await sendText('529993700779', 'ya normalizado');
    expect(cuerpoEnviado(fetchSpy).to).toBe('529993700779');
  });

  it('el resto del sobre sigue bien armado (no se rompió nada al normalizar)', async () => {
    await sendText('5219993700779', 'cuerpo del mensaje');
    const b = cuerpoEnviado(fetchSpy);
    expect(b.messaging_product).toBe('whatsapp');
    expect(b.type).toBe('text');
    expect(b.text).toEqual({ body: 'cuerpo del mensaje' });

    fetchSpy.mockClear();
    await sendDocument('5219993700779', 'https://x.test/l.pdf', 'liquidacion.pdf', 'Tu liquidación');
    const d = cuerpoEnviado(fetchSpy);
    expect(d.type).toBe('document');
    expect(d.document).toEqual({ link: 'https://x.test/l.pdf', filename: 'liquidacion.pdf', caption: 'Tu liquidación' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTACIÓN M15 — `verifySignature` devuelve `true` para cualquier firma.
//
// 628 verdes. Es la ÚNICA puerta del producto: cualquiera que conozca la URL
// puede inyectar mensajes como si fueran de Meta —gastos falsos, cierres de
// liquidación, consumo de tokens de OCR— contra el tenant del demo.
//
// La prueba tiene que afirmar los dos lados: que una firma buena pasa (si no,
// se puede "arreglar" devolviendo `false` siempre y la puerta queda cerrada con
// el producto adentro) y que CUALQUIER cambio la invalida.
// ═══════════════════════════════════════════════════════════════════════════
describe('verifySignature — HMAC de verdad, no un sello de goma', () => {
  const SECRETO = 'app-secret-de-prueba';
  const cuerpo = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'w1' }] } }] }] });
  const firmar = (body: string, secreto = SECRETO) =>
    'sha256=' + crypto.createHmac('sha256', secreto).update(body).digest('hex');

  beforeEach(() => { process.env.WHATSAPP_APP_SECRET = SECRETO; });

  it('la firma correcta pasa', () => {
    expect(verifySignature(cuerpo, firmar(cuerpo))).toBe(true);
  });

  it('sin firma NO pasa', () => {
    expect(verifySignature(cuerpo, null)).toBe(false);
    expect(verifySignature(cuerpo, '')).toBe(false);
  });

  it('una firma inventada NO pasa (M15: devolver true siempre)', () => {
    expect(verifySignature(cuerpo, 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(verifySignature(cuerpo, 'sha256=deadbeef')).toBe(false);
  });

  it('firmada con OTRO secreto NO pasa', () => {
    expect(verifySignature(cuerpo, firmar(cuerpo, 'otro-secreto'))).toBe(false);
  });

  // La propiedad que de verdad importa: la firma ata el CUERPO. Cambiar un peso
  // del payload tiene que invalidarla, o el atacante reusa una firma legítima
  // capturada y edita el monto.
  it('cambiar un solo byte del cuerpo invalida la firma', () => {
    const firma = firmar(cuerpo);
    expect(verifySignature(cuerpo.replace('w1', 'w2'), firma)).toBe(false);
    expect(verifySignature(cuerpo + ' ', firma)).toBe(false);
  });

  it('sin secreto configurado NO pasa nada (falla cerrado, no abierto)', () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect(verifySignature(cuerpo, firmar(cuerpo))).toBe(false);
  });
});
