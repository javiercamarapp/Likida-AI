import { describe, it, expect } from 'vitest';
import { destinatarioWhatsApp } from './client';

// EL FALLO QUE ESTO FIJA — medido contra la Graph API el 28-jul-2026, en la
// primera prueba real por WhatsApp. Mismo destinatario, mismo token, dos formas
// del mismo número:
//
//   to: 5219993700779  →  (#131030) Recipient phone number not in allowed list
//   to: 529993700779   →  aceptado, y responde wa_id 5219993700779
//
// Meta ENTREGA los entrantes con el "1" mexicano y RECHAZA los salientes que lo
// llevan. El código contestaba al mismo `from` que recibía, así que la respuesta
// rebotaba siempre, para todo operador mexicano.
//
// Lo que lo hacía caro: `sendText` no lanza, solo escribe en el log. El webhook
// devolvía 200, `agent.run` salía en verde y la liquidación se daba por
// entregada mientras el operador no recibía absolutamente nada.

describe('destinatario de WhatsApp', () => {
  it('quita el 1 mexicano que Meta emite pero no acepta', () => {
    expect(destinatarioWhatsApp('5219993700779')).toBe('529993700779');
  });

  it('deja igual el número que ya viene en la forma buena', () => {
    expect(destinatarioWhatsApp('529993700779')).toBe('529993700779');
  });

  it('limpia el "+" y los separadores de un número capturado a mano', () => {
    expect(destinatarioWhatsApp('+52 1 999 370 0779')).toBe('529993700779');
    expect(destinatarioWhatsApp('+52-999-370-0779')).toBe('529993700779');
  });

  // El límite: es una regla de México. Quitarle dígitos a otra lada rompería
  // números legítimos — un +52... no se parece a un +521... por casualidad.
  it('no toca números de otros países', () => {
    expect(destinatarioWhatsApp('15556596430')).toBe('15556596430');   // EE.UU.
    expect(destinatarioWhatsApp('5215551234')).toBe('5215551234');     // no son 10 dígitos tras el 521
    expect(destinatarioWhatsApp('34600123456')).toBe('34600123456');   // España
    expect(destinatarioWhatsApp('5511987654321')).toBe('5511987654321'); // Brasil, empieza en 55
  });

  it('un 521 con más de diez dígitos detrás no se recorta', () => {
    expect(destinatarioWhatsApp('52199937007799')).toBe('52199937007799');
  });
});
