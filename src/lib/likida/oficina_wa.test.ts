import { describe, expect, it } from 'vitest';
import { pideInformePdf, rolConAnalista, bloquesATextoWa } from './oficina_wa';

describe('pideInformePdf — anclado: reporte Y formato, o no es de aquí', () => {
  it('reconoce las formas reales de pedir el documento', () => {
    expect(pideInformePdf('mándame el informe en pdf')).toBe(true);
    expect(pideInformePdf('quiero el reporte en PDF')).toBe(true);
    expect(pideInformePdf('¿me pasas el resumen en documento?')).toBe(true);
  });
  it('NO se roba el informe de texto ni la plática', () => {
    expect(pideInformePdf('¿cómo van?')).toBe(false);
    expect(pideInformePdf('mándame el informe')).toBe(false);       // sin formato → texto
    expect(pideInformePdf('el pdf de la liquidación de Juan')).toBe(false); // sin palabra de reporte
  });
  it('un mensaje largo con las palabras adentro no es la petición', () => {
    expect(pideInformePdf('oye una duda, en el reporte que me pasaste el otro día venía un pdf que no abría y quería saber si me lo puedes reenviar cuando puedas por favor')).toBe(false);
  });
});

describe('rolConAnalista — el canal no es puerta trasera de dinero', () => {
  it('dueño y contador sí; el encargado NO (no ve pesos en el panel)', () => {
    expect(rolConAnalista('flota_admin')).toBe(true);
    expect(rolConAnalista('contador')).toBe(true);
    expect(rolConAnalista('encargado')).toBe(false);
  });
});

describe('bloquesATextoWa — los bloques del panel en texto de chat', () => {
  it('cifra con formato, tabla como líneas y la gráfica declarada como del panel', () => {
    const t = bloquesATextoWa([
      { tipo: 'texto', texto: 'El diésel subió esta semana.' },
      { tipo: 'cifra', valor: 8340.5, formato: 'mxn', nota: 'gasto de la semana' },
      { tipo: 'tabla', filas: [['Ruta GDL-MTY', 5200], ['Ruta CDMX-VER', '3,140.50']] },
      { tipo: 'dona', segmentos: [{ etiqueta: 'a', valor: 1 }] },
    ]);
    expect(t).toContain('El diésel subió esta semana.');
    expect(t).toContain('$8,340.50');
    expect(t).toContain('gasto de la semana');
    expect(t).toContain('· Ruta GDL-MTY: 5,200');
    expect(t).toContain('panel');
  });
  it('litros salen como litros, no como pesos', () => {
    expect(bloquesATextoWa([{ tipo: 'cifra', valor: 1200, formato: 'litros' }])).toContain('1,200 L');
  });
});
