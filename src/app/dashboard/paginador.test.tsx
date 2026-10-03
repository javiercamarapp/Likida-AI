import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnlacePagina, NavPaginas } from './paginador';

describe('los enlaces de página (uno solo para todo el panel)', () => {
  it('«Siguiente» lleva rel="next" y el ícono a la derecha; «Anterior» rel="prev" y el ícono a la izquierda', () => {
    const sig = renderToStaticMarkup(<EnlacePagina href="?p=3" direccion="siguiente" />);
    expect(sig).toContain('href="?p=3"');
    expect(sig).toContain('rel="next"');
    expect(sig).toMatch(/Siguiente<svg/);
    const ant = renderToStaticMarkup(<EnlacePagina href="?p=1" direccion="anterior" />);
    expect(ant).toContain('rel="prev"');
    expect(ant).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>Anterior/s);
  });

  it('un rótulo propio solo cuando el estándar no sirve; «inicio» no es ni prev ni next', () => {
    const ultima = renderToStaticMarkup(<EnlacePagina href="?p=9" direccion="siguiente" etiqueta="Ir a la última página (9)" />);
    expect(ultima).toContain('Ir a la última página (9)');
    const inicio = renderToStaticMarkup(<EnlacePagina href="?" direccion="inicio" />);
    expect(inicio).toContain('Volver al inicio');
    expect(inicio).not.toContain('rel=');
  });

  it('el contenedor es un <nav> con nombre accesible', () => {
    expect(renderToStaticMarkup(<NavPaginas><span /></NavPaginas>)).toContain('<nav aria-label="Paginación"');
  });
});
