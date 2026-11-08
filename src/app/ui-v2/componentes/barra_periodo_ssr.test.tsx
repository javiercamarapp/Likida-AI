import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarraPeriodo } from './barra-periodo';
import { hrefConParams, ocultosSin } from './barra-periodo-url';

const PERIODOS = [
  { valor: 'mes', etiqueta: 'Este mes', href: '/x?periodo=mes' },
  { valor: '30d', etiqueta: '30 días', href: '/x?periodo=30d' },
  { valor: 'custom', etiqueta: 'Personalizado', href: '/x?periodo=custom' },
];

describe('hrefConParams / ocultosSin (estado en la URL)', () => {
  it('aplica cambios, quita vacíos y SIEMPRE reinicia la paginación', () => {
    expect(hrefConParams('/x', { periodo: '30d', pagina: '3', moneda: 'USD' }, { periodo: 'mes', moneda: null })).toBe('/x?periodo=mes');
    expect(hrefConParams('/x', {}, {})).toBe('/x');
    expect(hrefConParams('/x', { b: '2', a: '1' })).toBe('/x?a=1&b=2');
    expect(hrefConParams('/x', { pagina: '3' }, {}, ['pagina'])).toBe('/x?pagina=3');
  });
  it('ocultosSin deja fuera lo que el formulario edita y la paginación', () => {
    expect(ocultosSin({ tenant: 't', desde: '2026-01-01', pagina: '2', q: '' }, ['desde'])).toEqual([['tenant', 't']]);
  });
});

describe('BarraPeriodo · render de servidor', () => {
  it('una fila: segmentado de enlaces con la opción vigente marcada, sin JavaScript', () => {
    const h = renderToStaticMarkup(<BarraPeriodo periodo={{ etiqueta: 'Periodo', valor: '30d', opciones: PERIODOS }} />);
    expect(h).toContain('role="group"');
    expect(h).toContain('<nav class="rv-seg rv-bp__seg"');
    expect(h.match(/<a /g)).toHaveLength(3);
    expect(h).toMatch(/<a [^>]*href="\/x\?periodo=30d"[^>]*aria-current="true"|<a [^>]*aria-current="true"[^>]*href="\/x\?periodo=30d"/);
    expect(h.match(/aria-current="true"/g)).toHaveLength(1);
  });
  it('chips: la «x» es un enlace con nombre accesible; el informativo no la lleva', () => {
    const h = renderToStaticMarkup(<BarraPeriodo chips={[{ id: 'r', etiqueta: '1 ago – 20 sep', hrefQuitar: '/x' }, { id: 'm', etiqueta: 'USD' }]} />);
    expect(h).toContain('<ul class="rv-bp__chips"');
    expect(h).toContain('aria-label="Quitar 1 ago – 20 sep"');
    expect(h).not.toContain('Quitar USD');
  });
  it('sin cajón no hay botón «Filtros» (no se inventan filtros); con cajón sí, con el contador', () => {
    expect(renderToStaticMarkup(<BarraPeriodo periodo={{ etiqueta: 'P', valor: 'mes', opciones: PERIODOS }} />)).not.toContain('Filtros');
    const h = renderToStaticMarkup(<BarraPeriodo cajon={{ accion: '/x', limpiarHref: '/x', nActivos: 2 }} accion={<a href="/pub">Última publicación</a>} />);
    expect(h).toContain('aria-haspopup="dialog"');
    expect(h).toMatch(/Filtros<\/span><span class="rv-bp__n"[^>]*>2</);
    expect(h).toContain('rv-bp__accion');
    expect(h).toContain('Última publicación');
  });
  it('el cajón cerrado no pinta el formulario en el servidor (el Drawer se monta al abrir)', () => {
    expect(renderToStaticMarkup(<BarraPeriodo cajon={{ accion: '/x', limpiarHref: '/x', nActivos: 0 }} />)).not.toContain('<form');
  });
});

describe('CajonFiltros · contenido abierto (render de servidor)', () => {
  const abierto = renderToStaticMarkup(<BarraPeriodo cajon={{
    abiertoInicial: true, accion: '/x', ocultos: [['tenant', 't-9']], limpiarHref: '/x?tenant=t-9', nActivos: 2, resumen: 'USD',
    periodo: { desde: '2026-08-01', hasta: '2026-09-20', nombreDesde: 'des_desde', nombreHasta: 'des_hasta' },
    monedaBase: { moneda: { nombre: 'moneda', etiqueta: 'Moneda', valor: 'USD', opciones: [{ valor: 'USD', rotulo: 'USD' }] } },
    campos: { items: [{ tipo: 'select', nombre: 'estado', etiqueta: 'Estado', valor: 'a', opciones: [{ valor: '', rotulo: 'Todos' }, { valor: 'a', rotulo: 'Abiertos' }] }, { tipo: 'texto', nombre: 'unidad', etiqueta: 'Unidad', valor: 'TC9' }] },
    fuentes: { nombre: 'fuente', opciones: [{ valor: 'hubspot', etiqueta: 'HubSpot', marca: 'hubspot' }], seleccionadas: ['hubspot'] },
  }} />);
  it('GET con el contexto oculto y los parámetros propios de la pantalla', () => {
    expect(abierto).toContain('method="get"');
    expect(abierto).toContain('name="tenant" value="t-9"');
    expect(abierto).toContain('name="des_desde"');
    expect(abierto).toContain('value="2026-08-01"');
    expect(abierto).toContain('name="estado"');
    expect(abierto).toContain('name="unidad"');
    expect(abierto).toContain('value="TC9"');
  });
  it('resumen, secciones h3 y nota de paginación; las fuentes usan ChipFuente (casilla) y dicen «Sin selección se incluyen todas»', () => {
    expect(abierto).toContain('2 filtros activos');
    expect(abierto).toContain('>Periodo</h3>');
    expect(abierto).toContain('>Moneda y base</h3>');
    expect(abierto).toContain('>Fuentes</h3>');
    expect(abierto).toContain('type="checkbox"');
    expect(abierto).toContain('Sin selección se incluyen todas.');
    expect(abierto).toContain('Cambiar filtros reinicia la paginación.');
    expect(abierto).toContain('Limpiar');
  });
});

describe('R8 · el CSS de la barra respeta la escala y los tokens', () => {
  const css = readFileSync(join(__dirname, '..', 'barra-periodo.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('sin tamaños 11.5 / 12.5 / 13.5 / 22 px', () => { expect(css).not.toMatch(/\b(11\.5|12\.5|13\.5|22)px/); });
  it('el activo usa --seg-activo-*, no un azul suelto', () => {
    expect(css).toContain('var(--seg-activo-bg)');
    expect(css).not.toMatch(/#(?:2f6bd8|1f4fb0|e6edfa)/i);
  });
});
