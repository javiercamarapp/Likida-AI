import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Boton, Escena, EstadoVacio, iniciales, matizDeId, Monograma } from './index';

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

describe('EstadoVacio v2 / Escena', () => {
  it('cada escena es un SVG decorativo; con título es img', () => {
    for (const id of ['desglose-correo', 'documento-revision', 'conexion-tms', 'bienvenida', 'listo'] as const) {
      const h = renderToStaticMarkup(<Escena id={id} />);
      expect(h).toContain('<svg');
      expect(h).toContain('aria-hidden="true"');
      expect(h).not.toContain('<text'); // sin texto incrustado
    }
    expect(renderToStaticMarkup(<Escena id="listo" titulo="Listo" />)).toContain('role="img"');
  });
  it('escena animada solo cambia la clase; usa color del tema, nada fijo', () => {
    const h = renderToStaticMarkup(<Escena id="conexion-tms" animada />);
    expect(h).toContain('rv-escena--anima');
    expect(h).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('vacío: título, qué falta y CTA real; compacto sin arte', () => {
    const h = renderToStaticMarkup(<EstadoVacio escena="conexion-tms" titulo="Sin conexión" accion={<Boton>Entregar archivo de muestra</Boton>}>Falta el archivo.</EstadoVacio>);
    expect(h).toContain('Sin conexión');
    expect(h).toContain('<button');
    expect(renderToStaticMarkup(<EstadoVacio escena="listo" titulo="x" compacto />)).not.toContain('rv-vacio__arte');
  });
});
