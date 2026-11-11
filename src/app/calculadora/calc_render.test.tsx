import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Calculadora } from './calc';

// La calculadora pública usa los campos y el botón del sistema: sin style= ni inputs sin etiqueta. El resultado no se pinta antes de calcular.
describe('Calculadora pública', () => {
  const html = renderToStaticMarkup(<Calculadora />);
  it('cada dato tiene su etiqueta y el botón de calcular es un Boton del sistema', () => {
    expect((html.match(/<label\b/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(html).toMatch(/<button[^>]*rv-btn--primary/);
  });
  it('sin estilos en línea y sin resultado hasta calcular', () => {
    expect(html).not.toContain(' style="');
    expect(html).not.toContain('rv-calc__resultado');
  });
});
