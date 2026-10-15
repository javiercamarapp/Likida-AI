import { describe, it, expect } from 'vitest';
import { armarHtml, armarHtmlSobrio, aTextoPlanoSobrio, type Correo } from './plantilla';

const C: Correo = {
  asunto: 'Tu desglose',
  avance: 'Adjunto tu desglose',
  titulo: 'Desglose de la semana',
  parrafos: ['Adjuntamos el desglose.'],
  datos: [['Folio', 'F-1']],
  porQueLoRecibes: 'Lo recibes porque eres operador de la flota.',
  bajaHref: 'https://app.likida.ai/baja/x',
};

describe('plantilla sobria (T-A1-12)', () => {
  it('no lleva logo, wordmark ni pie de marca ni liga de baja', () => {
    const html = armarHtmlSobrio(C);
    expect(html).not.toContain('cid:');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('LIKIDA');
    expect(html).not.toMatch(/Liquidaci&oacute;n de viajes por WhatsApp/);
    expect(html).not.toContain('Darme de baja');
    expect(html).not.toContain('/baja/x');
  });
  it('conserva el contenido y la línea neutra de por qué llega', () => {
    const html = armarHtmlSobrio(C);
    expect(html).toContain('Desglose de la semana');
    expect(html).toContain('F-1');
    expect(html).toContain('Lo recibes porque eres operador de la flota.');
  });
  it('escapa los datos como marcado', () => {
    expect(armarHtmlSobrio({ ...C, titulo: '<img onerror=x>' })).not.toContain('<img onerror');
  });
  it('el texto plano sobrio no lleva marca', () => {
    const t = aTextoPlanoSobrio(C);
    expect(t).not.toContain('LIKIDA');
    expect(t).not.toContain('Likida');
    expect(t).toContain('Lo recibes porque');
  });
  it('la plantilla de siempre sigue con logo y baja', () => {
    const html = armarHtml(C);
    expect(html).toContain('cid:likida-logo');
    expect(html).toContain('Darme de baja');
  });
});
