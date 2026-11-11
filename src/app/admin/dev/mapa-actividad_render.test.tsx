import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapaActividad } from './mapa-actividad';

// El mapa de actividad pinta cada día como un radio nativo (sin <button> ni style=): el nivel de intensidad sale de data-nivel.
describe('MapaActividad', () => {
  const html = renderToStaticMarkup(
    <MapaActividad total={9} semanas={[{ inicio: Date.UTC(2026, 9, 18), dias: [0, 1, 2, 4, 0, 0, 3] }]} />,
  );
  it('un radio por día, con su fecha y su nivel de intensidad', () => {
    expect((html.match(/type="radio"/g) ?? []).length).toBe(7);
    expect(html).toContain('data-nivel="0"');
    expect(html).toContain('data-nivel="4"');
    expect(html).toContain('domingo');
  });
  it('sin botones crudos ni estilos en línea', () => {
    expect(html).not.toContain('<button');
    expect(html).not.toContain(' style="');
  });
});
