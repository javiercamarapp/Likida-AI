import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FilaTarjetas, MarcoPagina, Tarjeta, type VarianteFila } from './index';
import { EsqPagina } from './esqueleto';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const css = readFileSync(join(__dirname, 'fila-tarjetas.css'), 'utf8');
const VARIANTES: VarianteFila[] = ['8-4', '4-4-4', '6-6', '4-8', '12'];

describe('FilaTarjetas', () => {
  it('pinta un contenedor con la variante pedida y sus hijos, sin style en línea', () => {
    for (const v of VARIANTES) {
      const html = renderToStaticMarkup(<FilaTarjetas variante={v}><Tarjeta titulo="A">a</Tarjeta><Tarjeta titulo="B">b</Tarjeta></FilaTarjetas>);
      expect(html).toContain('class="rv-fila"');
      expect(html).toContain(`data-variante="${v}"`);
      expect(html.match(/rv-tarjeta"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(html).not.toContain('style=');
    }
  });

  it('`llena` marca la fila para absorber el alto sobrante; sin ella, no', () => {
    expect(renderToStaticMarkup(<FilaTarjetas variante="6-6" llena />)).toContain('data-llena');
    expect(renderToStaticMarkup(<FilaTarjetas variante="6-6" />)).not.toContain('data-llena');
  });

  it('el CSS define las cinco variantes sobre 12 columnas y los puntos de corte del contrato', () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(12,/);
    for (const v of VARIANTES) expect(css).toContain(`data-variante="${v}"`);
    expect(css).toMatch(/span 8/);
    expect(css).toMatch(/span 4/);
    expect(css).toMatch(/max-width:\s*1023\.98px/); // ≤1023 → 6+6
    expect(css).toMatch(/max-width:\s*767\.98px/); // móvil → una columna
    expect(css).toMatch(/gap:\s*10px/);
  });

  it('a ≤1023 px todo pasa a 6+6 y a móvil a una columna completa', () => {
    const tablet = css.slice(css.indexOf('max-width: 1023.98px'), css.indexOf('max-width: 767.98px'));
    expect(tablet).toMatch(/span 6/);
    expect(tablet).toMatch(/4-4-4"\] > :last-child:nth-child\(odd\)\s*\{\s*grid-column:\s*1 \/ -1/);
    const movil = css.slice(css.indexOf('max-width: 767.98px'));
    expect(movil).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it('sin hex, sin !important y la animación solo bajo `prefers-reduced-motion: no-preference`', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain('!important');
    const antes = css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(antes).not.toMatch(/animation/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
  });

  it('convive con MarcoPagina como bloque hijo', () => {
    const html = renderToStaticMarkup(<MarcoPagina titulo="Resumen"><FilaTarjetas variante="8-4"><Tarjeta titulo="A">a</Tarjeta><Tarjeta titulo="B">b</Tarjeta></FilaTarjetas></MarcoPagina>);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.indexOf('rv-fila')).toBeGreaterThan(html.indexOf('<h1'));
  });
});

describe('EsqPagina · variante sinEncabezado', () => {
  it('por omisión trae el encabezado de esqueleto; con `sinEncabezado` solo cubre cifras y tarjetas', () => {
    const con = renderToStaticMarkup(<EsqPagina />);
    const sin = renderToStaticMarkup(<EsqPagina sinEncabezado />);
    expect(con).toContain('rv-encabezado');
    expect(sin).not.toContain('rv-encabezado');
    expect(sin).not.toContain('rv-esq-encabezado');
    expect(sin).toContain('rv-esq-cifras');
    expect(sin.match(/class="rv-tarjeta rv-esq"/g)).toHaveLength(2);
    expect(sin).toContain('data-sin-encabezado');
    expect(con).not.toContain('data-sin-encabezado');
    expect(sin).toContain('aria-busy="true"');
  });
});
