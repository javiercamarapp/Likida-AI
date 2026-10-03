import { describe, it, expect } from 'vitest';
import { clasificarPorReglas } from './intencion';
import type { Intencion } from './tipos';

function intencionDe(t: string): Intencion | null {
  return clasificarPorReglas(t)?.intencion ?? null;
}

describe('intención por reglas — lo que de verdad escribe un cliente', () => {
  const casos: Array<[Intencion, string[]]> = [
    ['ubicacion', [
      '¿Dónde va mi viaje?', 'donde esta mi camion', 'Buenas, ¿en qué parte va mi carga?', 'me pueden dar la ubicación de la unidad',
      'ya salió el embarque?', '¿Cómo va mi viaje F-1042?', 'estatus de mi entrega', 'rastreo de la unidad por favor',
    ]],
    ['eta', [
      '¿A qué hora llega?', 'cuando llega mi carga', 'cuánto falta para que llegue', 'hora estimada de entrega', 'para cuándo me llega el pedido',
    ]],
    ['documentos', [
      '¿Qué documentos me faltan?', 'falta algún documento de mi parte?', 'documentos pendientes del viaje', 'necesito la carta porte',
    ]],
    ['factura_pod', [
      'Mándame la factura del viaje', 'necesito el XML', 'me pasan el POD', 'comprobante de entrega por favor', 'acuse de recibo',
    ]],
    ['pide_humano', [
      'Quiero hablar con una persona', 'necesito un asesor', 'pásame con tu gerente', 'llámenme por favor', '¿eres un bot?', 'quiero hablar con alguien',
    ]],
    ['queja', [
      'Tengo una queja', 'esto es inaceptable', 'pésimo servicio', 'estoy muy molesto', 'nadie me contesta', 'la mercancía llegó dañada', 'voy a cancelar el contrato',
    ]],
    ['baja', ['BAJA', 'stop', 'Cancelar', 'quiero darme de baja', 'ya no me escriban', 'no quiero recibir mensajes']],
    ['saludo', ['Hola', 'buenos días', 'Gracias', 'ok', 'muchas gracias']],
  ];
  for (const [esperada, textos] of casos) {
    for (const t of textos) it(`${esperada}: «${t}»`, () => expect(intencionDe(t)).toBe(esperada));
  }

  it('lo que no reconoce devuelve null (le toca al modelo o a un humano)', () => {
    for (const t of ['', '   ', 'asdf qwer', 'el clima está muy bonito hoy', '12345']) expect(clasificarPorReglas(t), t).toBeNull();
  });

  it('prioridad: baja > pide_humano > queja > dato (ante la duda, un humano)', () => {
    expect(intencionDe('quiero hablar con una persona, esto es inaceptable')).toBe('pide_humano');
    expect(intencionDe('pésimo servicio, ¿dónde va mi viaje?')).toBe('queja');
    expect(intencionDe('¿dónde va mi viaje? quiero hablar con un asesor')).toBe('pide_humano');
  });

  it('«baja» solo en mensajes cortos: la baja de una unidad NO es un opt-out', () => {
    expect(intencionDe('la baja de la unidad 12 ya quedó, pero ¿dónde va mi viaje de mañana?')).not.toBe('baja');
    expect(intencionDe('mi jefe dio de baja la orden de compra de la semana pasada y quiero saber el estatus del embarque')).not.toBe('baja');
  });

  it('dos preguntas en un mensaje: la principal y la secundaria', () => {
    const c = clasificarPorReglas('¿Dónde va mi viaje y a qué hora llega?');
    expect(c?.intencion).toBe('eta');
    expect(c?.secundarias).toEqual(['ubicacion']);
    expect(c?.clasificador).toBe('reglas');
  });

  it('un saludo con una pregunta es la pregunta, no el saludo', () => {
    expect(intencionDe('Hola buenas tardes, ¿dónde va mi viaje?')).toBe('ubicacion');
  });

  it('acentos, mayúsculas y signos no cambian el resultado', () => {
    expect(intencionDe('¿¿DÓNDE VA MI CAMIÓN??')).toBe('ubicacion');
    expect(intencionDe('A QUE HORA LLEGA!!!')).toBe('eta');
  });

  it('no se cuelga con un mensaje enorme o patológico', () => {
    const inicio = Date.now();
    clasificarPorReglas('donde '.repeat(3_000));
    clasificarPorReglas(`${'a '.repeat(4_000)}hora llega`);
    expect(Date.now() - inicio).toBeLessThan(1_500);
  });
});
