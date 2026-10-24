import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Funnel, Heatmap, StackedBars } from './graficas';

// A37-S08-08
it('Funnel con paso base en cero no fabrica 500 % ni anchos > 100 %', () => {
  const html = renderToStaticMarkup(<Funnel pasos={[{ etiqueta: 'Visitas', valor: 0 }, { etiqueta: 'Altas', valor: 5 }]} />);
  expect(html).not.toContain('500%');
  expect(html).toContain('· —');
  expect(html).not.toMatch(/width:(\d{3,}|[1-9]\d\d\.)/); // ningún ancho de 100 % o más (salvo exactamente 100%)
});

it('Funnel normal: separador de miles y conversión entre pasos', () => {
  const html = renderToStaticMarkup(<Funnel pasos={[{ etiqueta: 'A', valor: 1000 }, { etiqueta: 'B', valor: 500 }]} />);
  expect(html).toContain('1,000');
  expect(html).toContain('· 50%');
});

it('Heatmap: una celda faltante dice «sin dato» y no se pinta como un 0 medido', () => {
  const html = renderToStaticMarkup(<Heatmap filas={['L', 'M']} columnas={['a', 'b']} valores={[[1, 2], [3]]} />);
  expect(html).toContain('M · b: sin dato');
  expect(html).not.toContain('M · b: 0');
});

it('StackedBars: un valor faltante no produce NaN', () => {
  const html = renderToStaticMarkup(<StackedBars categorias={['x', 'y']} series={[{ nombre: 's', valores: [3] }]} />);
  expect(html).not.toContain('NaN');
});
