import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionClasesCobro } from './clases-cobro';

const nada = async () => {};
const acciones = { guardarReglasFlota: nada };

describe('SeccionClasesCobro (A2 ola 1)', () => {
  it('defaults: utilitarios vacíos (no se evalúa) y la clase 1 como tarifa por pasada preseleccionada', () => {
    const html = renderToStaticMarkup(<SeccionClasesCobro datos={{ reglas: { clasesUtilitario: [], clase1: 'todas' }, puedeEditar: true, acciones }} />);
    expect(html).toContain('Vacío = no se evalúa');
    expect(html).toMatch(/name="clase_uno" checked="" value="todas"/);
    expect(html).not.toMatch(/name="clase_uno" checked="" value="declaradas"/);
    expect(html).toContain('Tarifa por pasada en todas las casetas');
  });
  it('muestra lo guardado', () => {
    const html = renderToStaticMarkup(<SeccionClasesCobro datos={{ reglas: { clasesUtilitario: [1, 2], clase1: 'declaradas' }, puedeEditar: true, acciones }} />);
    expect(html).toContain('value="1, 2"');
    expect(html).toMatch(/name="clase_uno" checked="" value="declaradas"/);
  });
  it('solo lectura para quien no edita; sin lectura no afirma nada', () => {
    const ro = renderToStaticMarkup(<SeccionClasesCobro datos={{ reglas: { clasesUtilitario: [], clase1: 'todas' }, puedeEditar: false, acciones }} />);
    expect(ro).not.toContain('<form');
    expect(ro).toContain('sin clases declaradas');
    const nulo = renderToStaticMarkup(<SeccionClasesCobro datos={{ reglas: null, puedeEditar: true, acciones }} />);
    expect(nulo).toContain('No se pudo leer');
    expect(nulo).not.toContain('<form');
  });
});
