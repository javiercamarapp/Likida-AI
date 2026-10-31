import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Boton, EstadoVacio, iniciales, matizDeId, Monograma } from './index';

describe('Monograma', () => {
  it('iniciales: conectores ignorados, una palabra = 2 letras, vacío seguro', () => {
    expect(iniciales('Transportes del Norte')).toBe('TN');
    expect(iniciales('Fletes (Demo)')).toBe('FD');
    expect(iniciales('Acme')).toBe('AC');
    expect(iniciales('de la')).toBe('·');
  });
  it('el matiz sale del id (estable) y no del nombre', () => {
    expect(matizDeId('abc-123')).toBe(matizDeId('abc-123'));
    const a = renderToStaticMarkup(<Monograma id="x1" nombre="Uno" />);
    const b = renderToStaticMarkup(<Monograma id="x1" nombre="Otro Nombre" />);
    expect(a.match(/data-matiz="\d"/)![0]).toBe(b.match(/data-matiz="\d"/)![0]);
    expect(a).toContain('aria-hidden="true"');
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) expect(matizDeId(id)).toBeGreaterThanOrEqual(1);
  });
});

describe('EstadoVacio v2', () => {
  it('una línea punteada: título, qué falta y CTA real; sin ilustración aunque se pase `escena`', () => {
    const h = renderToStaticMarkup(<EstadoVacio escena="conexion-tms" titulo="Sin conexión" accion={<Boton>Entregar archivo de muestra</Boton>}>Falta el archivo.</EstadoVacio>);
    expect(h).toContain('Sin conexión');
    expect(h).toContain('<button');
    expect(h).not.toContain('<svg');
    expect(h).not.toContain('rv-vacio__arte');
  });
});
