import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EstadoVacio, LARGO_MAX_VACIO, largoTexto } from './estados';

describe('EstadoVacio de /dashboard (contenido)', () => {
  it('es contenido, lleva icono sobrio y la línea corta va tal cual', () => {
    const html = renderToStaticMarkup(<EstadoVacio titulo="Sin facturas">Aún no hay facturas emitidas.</EstadoVacio>);
    expect(html).toContain('data-contenido');
    expect(html).toContain('rv-vacio__icono');
    expect(html).toContain('Aún no hay facturas emitidas.');
    expect(html).not.toContain('Ver más');
  });
  it('una explicación larga queda plegada en «Ver más», sin perder una palabra', () => {
    const largo = 'x'.repeat(LARGO_MAX_VACIO + 10);
    const html = renderToStaticMarkup(<EstadoVacio><strong>{largo}</strong></EstadoVacio>);
    expect(html).toContain('<details class="rv-vacio__mas"><summary>Ver más</summary>');
    expect(html).toContain(largo);
  });
  it('la acción única sigue saliendo', () => {
    const html = renderToStaticMarkup(<EstadoVacio accion={{ href: '/dashboard/facturacion', texto: 'Registrar factura' }}>Nada.</EstadoVacio>);
    expect(html).toContain('href="/dashboard/facturacion"');
  });
  it('largoTexto suma cadenas anidadas', () => {
    expect(largoTexto(<p>ab<b>cde</b>{['f', 'g']}</p>)).toBe(7);
  });
});
