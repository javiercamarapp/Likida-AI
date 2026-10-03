import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dona, Serie } from './graficas';

describe('las gráficas del asistente en la caja de preguntas', () => {
  it('la dona pinta las proporciones con su leyenda en números y una etiqueta accesible', () => {
    const html = renderToStaticMarkup(<Dona b={{ tipo: 'dona', segmentos: [{ etiqueta: 'A tiempo', valor: 8 }, { etiqueta: 'Atrasado', valor: 2 }] }} />);
    expect(html).toContain('A tiempo');
    expect(html).toContain('80 %');
    expect(html).toContain('20 %');
    expect(html).toContain('aria-label="A tiempo: 8 (80 %), Atrasado: 2 (20 %)"');
  });
  it('una dona en cero no divide entre cero', () => {
    const html = renderToStaticMarkup(<Dona b={{ tipo: 'dona', segmentos: [{ etiqueta: 'Nada', valor: 0 }] }} />);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });
  it('la serie pinta la línea, sus extremos y el mínimo y el máximo; un solo punto no rompe', () => {
    const html = renderToStaticMarkup(<Serie b={{ tipo: 'serie', puntos: [{ dia: '2026-10-01', valor: 3 }, { dia: '2026-10-02', valor: 5 }, { dia: '2026-10-03', valor: 4 }] }} />);
    expect(html).toContain('<polyline');
    expect(html).toContain('2026-10-01');
    expect(html).toContain('2026-10-03');
    expect(html).toMatch(/mín .*3.* · máx .*5/);
    const uno = renderToStaticMarkup(<Serie b={{ tipo: 'serie', puntos: [{ dia: '2026-10-01', valor: 7 }] }} />);
    expect(uno).not.toContain('NaN');
  });
});
