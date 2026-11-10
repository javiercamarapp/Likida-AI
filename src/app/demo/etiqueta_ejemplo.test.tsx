import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Demo from './page';

// F16: los datos de demostración se rotulan «Ejemplo» a la vista (viaje, montos, folios y RFC son ficticios).
describe('/demo', () => {
  it('muestra la etiqueta «Ejemplo» junto a la conversación', () => {
    const html = renderToStaticMarkup(<Demo />);
    expect(html).toContain('data-testid="etiqueta-ejemplo"');
    expect(html).toMatch(/>Ejemplo</);
  });
  it('el apoyo de la página dice que son datos ficticios', () => {
    expect(renderToStaticMarkup(<Demo />)).toContain('datos ficticios');
  });
});
