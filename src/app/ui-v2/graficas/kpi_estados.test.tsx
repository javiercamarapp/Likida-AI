import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChartState, CheckExito, KindBadge, ProgresoAnillo, TiraKpi } from './index';

describe('TiraKpi', () => {
  it('valor null = «—» + Sin dato; NUNCA 0', () => {
    const html = renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'Peajes cruzados', valor: null }]} />);
    expect(html).toContain('>—<');
    expect(html).toContain('Sin dato');
    expect(html).not.toMatch(/>0</);
  });
  it('el valor real está en el HTML servido (sin count-up) y se formatea con lib/formato', () => {
    const html = renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'Viajes', valor: 1234 }]} />);
    expect(html).toContain('1,234');
  });
  it('delta: flecha + texto + sentido accesible; color solo en el chip', () => {
    const html = renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'A', valor: '10', delta: { texto: '+4 %', dir: 'sube', bueno: 'sube' } }]} />);
    expect(html).toContain('▲');
    expect(html).toContain('(sube)');
    expect(html).toContain('data-tono="ok"');
    const malo = renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'A', valor: '10', delta: { texto: '+4 %', dir: 'sube', bueno: 'baja' } }]} />);
    expect(malo).toContain('data-tono="bad"');
  });
  it('con href es un enlace real; la serie corta no dibuja sparkline', () => {
    const html = renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'A', valor: '1', href: '/dashboard/x', serie: [1] }]} />);
    expect(html).toContain('<a ');
    expect(html).not.toContain('<svg');
  });
});

describe('KindBadge / ChartState / Anillo / Check', () => {
  it('KindBadge: icono + texto por cada tipo', () => {
    for (const [t, txt] of [['observado', 'Observado'], ['estimado', 'Estimado'], ['inferido', 'Inferido'], ['sin_dato', 'Sin dato']] as const) {
      const h = renderToStaticMarkup(<KindBadge tipo={t} />);
      expect(h).toContain(txt);
      expect(h).toContain('<svg');
      expect(h).toContain(`data-tipo="${t}"`);
    }
  });
  it('ChartState: ok devuelve hijos; error es alert; vacío dice qué falta', () => {
    expect(renderToStaticMarkup(<ChartState estado="ok"><i>x</i></ChartState>)).toBe('<i>x</i>');
    expect(renderToStaticMarkup(<ChartState estado="error" mensaje="Servicio lento" />)).toContain('role="alert"');
    const v = renderToStaticMarkup(<ChartState estado="vacio" mensaje="Falta el archivo de muestra" />);
    expect(v).toContain('Falta el archivo de muestra');
    const c = renderToStaticMarkup(<ChartState estado="cargando" />);
    expect(c).toContain('aria-busy="true"');
  });
  it('ProgresoAnillo: progressbar con valor exacto; null = sin dato, no 0 %', () => {
    const h = renderToStaticMarkup(<ProgresoAnillo valor={42.4} etiqueta="Avance" />);
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="42"');
    expect(h).toContain('pathLength="100"');
    const n = renderToStaticMarkup(<ProgresoAnillo valor={null} etiqueta="Avance" />);
    expect(n).not.toContain('aria-valuenow');
    expect(n).toContain('Sin dato');
    expect(n).not.toContain('0%');
    expect(renderToStaticMarkup(<ProgresoAnillo valor={150} etiqueta="a" />)).toContain('aria-valuenow="100"');
  });
  it('CheckExito: decorativo por defecto, img con etiqueta', () => {
    expect(renderToStaticMarkup(<CheckExito />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<CheckExito etiqueta="Guardado" />)).toContain('role="img"');
  });
});
