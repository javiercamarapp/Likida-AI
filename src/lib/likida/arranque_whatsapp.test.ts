import { describe, it, expect } from 'vitest';
import { numeroWhatsAppDeLikida, normalizarDigitos, formatoVisible, textoDeArranque, enlaceWaMe } from './arranque_whatsapp';

describe('numeroWhatsAppDeLikida — nunca inventa un número', () => {
  it('sin variable (o vacía, o con un marcador como [SENSITIVE]) es «sin_configurar»', () => {
    expect(numeroWhatsAppDeLikida({})).toEqual({ estado: 'sin_configurar' });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '' })).toEqual({ estado: 'sin_configurar' });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '[SENSITIVE]' })).toEqual({ estado: 'sin_configurar' });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: 'tu-numero-aqui' })).toEqual({ estado: 'sin_configurar' });
  });

  it('NO deriva el número de WHATSAPP_PHONE_NUMBER_ID (es un id interno de Meta, no un teléfono)', () => {
    expect(numeroWhatsAppDeLikida({ WHATSAPP_PHONE_NUMBER_ID: '123456789012345' })).toEqual({ estado: 'sin_configurar' });
  });

  it('acepta el número con formato y lo normaliza para wa.me', () => {
    const n = numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '+52 (55) 1234-5678' });
    expect(n).toEqual({ estado: 'configurado', digitos: '525512345678', visible: '+52 55 1234 5678', esPrueba: false });
  });

  it('el 521 de Meta se normaliza a 52 (wa.me)', () => {
    const n = numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '5215512345678' });
    expect(n).toMatchObject({ estado: 'configurado', digitos: '525512345678' });
  });

  it('un número de OTRO país se acepta tal cual', () => {
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '+1 415 555 2671' })).toMatchObject({ estado: 'configurado', digitos: '14155552671', visible: '+14155552671' });
  });

  it('un número de prueba se muestra, MARCADO', () => {
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '525512345678', LIKIDA_WHATSAPP_NUMERO_PRUEBA: 'true' })).toMatchObject({ esPrueba: true });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '525512345678', LIKIDA_WHATSAPP_NUMERO_PRUEBA: '0' })).toMatchObject({ esPrueba: false });
  });

  it('basura se rechaza DICIENDO por qué (no se enseña un teléfono que no existe)', () => {
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: 'llámame' })).toMatchObject({ estado: 'invalido' });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '12345' })).toMatchObject({ estado: 'invalido' });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '5255123' })).toMatchObject({ estado: 'invalido' });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '1'.repeat(20) })).toMatchObject({ estado: 'invalido' });
    expect(numeroWhatsAppDeLikida({ LIKIDA_WHATSAPP_NUMERO: '52551234567' })).toMatchObject({ estado: 'invalido', motivo: expect.stringMatching(/52 y 10 dígitos/) });
  });
});

describe('normalizarDigitos / formatoVisible', () => {
  it('quita todo lo que no es dígito', () => {
    expect(normalizarDigitos('+52 55-1234.5678')).toBe('525512345678');
  });
  it('formatea México legible y deja otros países como +dígitos', () => {
    expect(formatoVisible('525512345678')).toBe('+52 55 1234 5678');
    expect(formatoVisible('14155552671')).toBe('+14155552671');
  });
});

describe('el texto y el enlace de arranque', () => {
  it('el texto lleva el nombre de la flota y colapsa espacios', () => {
    expect(textoDeArranque('  Transportes   del Norte ')).toBe('Hola, soy chofer de Transportes del Norte. Quiero empezar a mandar mis comprobantes por Likida.');
  });
  it('sin nombre cae a un texto neutro; un nombre larguísimo se recorta', () => {
    expect(textoDeArranque('')).toContain('chofer de mi flota');
    expect(textoDeArranque('x'.repeat(500)).length).toBeLessThan(200);
  });
  it('el enlace codifica el texto (acentos, signos, espacios): no se parte el query', () => {
    const url = enlaceWaMe('525512345678', 'Hola, soy chofer de Peña & Núñez #1');
    expect(url).toBe('https://wa.me/525512345678?text=Hola%2C%20soy%20chofer%20de%20Pe%C3%B1a%20%26%20N%C3%BA%C3%B1ez%20%231');
    expect(new URL(url).searchParams.get('text')).toBe('Hola, soy chofer de Peña & Núñez #1');
  });
});
