import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarraFiltros } from './barra-filtros';
import { FiltroBusqueda, FiltroOpciones } from './filtros';

const OPC = [{ valor: '', rotulo: 'Todos' }, { valor: 'a', rotulo: 'Abiertos' }];

describe('filtros · render de servidor (sin JavaScript)', () => {
  it('M2: el chip nace oculto y el respaldo es un select nativo en noscript (sin chip muerto ni parámetro duplicado)', () => {
    const h = renderToStaticMarkup(<BarraFiltros accion="/x"><FiltroOpciones nombre="estado" etiqueta="Estado" valor="a" opciones={OPC} /></BarraFiltros>);
    expect(h).toMatch(/<button[^>]*class="rv-fl"[^>]*hidden/);
    expect(h).toContain('<noscript>');
    expect(h).toContain('<select name="estado"');
    expect(h).not.toContain('type="hidden" name="estado"'); // el campo oculto solo existe con JS
  });
  it('modo enlace: las opciones salen como enlaces en noscript', () => {
    const h = renderToStaticMarkup(<FiltroOpciones etiqueta="Estado" valor="a" opciones={[{ valor: 'a', rotulo: 'Abiertos', href: '/v?f=a' }]} />);
    expect(h).toContain('href="/v?f=a"');
  });
  it('modo cliente (sin nombre ni href) no oculta el chip: no tiene respaldo y no se rompe', () => {
    const h = renderToStaticMarkup(<FiltroOpciones etiqueta="Periodo" valor="" onCambio={() => {}} opciones={OPC} />);
    expect(h).not.toMatch(/<button[^>]*hidden/);
  });
  it('B2: role=search solo si la barra tiene búsqueda', () => {
    expect(renderToStaticMarkup(<BarraFiltros accion="/x"><FiltroOpciones nombre="e" etiqueta="E" valor="" opciones={OPC} /></BarraFiltros>)).not.toContain('role="search"');
    expect(renderToStaticMarkup(<BarraFiltros accion="/x" buscar><FiltroBusqueda nombre="q" /></BarraFiltros>)).toContain('role="search"');
  });
  it('B1: valor fuera de las opciones dice «Valor no válido», no el id', () => {
    const h = renderToStaticMarkup(<FiltroOpciones etiqueta="Terminal" valor="uuid-raro" opciones={OPC} onCambio={() => {}} />);
    expect(h).toContain('Valor no válido');
    expect(h).not.toContain('uuid-raro');
  });
});
