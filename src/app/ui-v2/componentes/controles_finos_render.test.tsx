import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INFO, type InfoClave } from '../info-catalogo';
import { Boton, BotonEnlace, Chip, InfoTip, SegmentedControl } from './index';

// CONTROLES FINOS (K1): las primitivas devuelven SOLO clases del kit (rv-*), sin estilos en línea ni clases gruesas de Tailwind.
const GRUESO = /\b(?:h-(?:9|10|11|12|14)|py-(?:2\.5|3|4)|px-(?:5|6)|rounded-(?:xl|2xl|3xl|full)|border-2|shadow-(?:md|lg|xl|2xl)|text-(?:base|lg|xl))\b/;

describe('Boton · variantes del kit', () => {
  const variantes = ['primary', 'secondary', 'ghost', 'danger', 'danger-soft', 'suave'] as const;
  it.each(variantes)('%s: clase rv-btn--%s, sin style= ni clases gruesas', (v) => {
    const h = renderToStaticMarkup(<Boton variante={v}>Guardar</Boton>);
    expect(h).toContain('rv-btn');
    expect(h).toContain(`rv-btn--${v}`);
    expect(h).not.toContain('style=');
    expect(h).not.toMatch(GRUESO);
  });
  it('sm, loading y disabled conservan las clases del kit', () => {
    expect(renderToStaticMarkup(<Boton tamano="sm">x</Boton>)).toContain('rv-btn--sm');
    const l = renderToStaticMarkup(<Boton loading>x</Boton>);
    expect(l).toContain('rv-btn__spinner');
    expect(l).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<Boton disabled>x</Boton>)).toContain('disabled=""');
  });
  it('BotonEnlace suave también es un rv-btn', () => {
    const h = renderToStaticMarkup(<BotonEnlace variante="suave" href="/a">Aplicar</BotonEnlace>);
    expect(h).toContain('rv-btn--suave');
    expect(h).toContain('href="/a"');
  });
});

describe('Chip, SegmentedControl e InfoTip', () => {
  it('Chip no lleva estilos en línea ni clases gruesas', () => {
    const h = renderToStaticMarkup(<Chip tono="ok">Activo</Chip>);
    expect(h).toContain('rv-chip');
    expect(h).not.toMatch(GRUESO);
  });
  it('SegmentedControl: radiogroup con radios y aria-checked', () => {
    const h = renderToStaticMarkup(<SegmentedControl etiqueta="Periodo" valor="a" onChange={() => {}} opciones={[{ valor: 'a', etiqueta: 'A' }, { valor: 'b', etiqueta: 'B' }]} />);
    expect(h).toContain('role="radiogroup"');
    expect(h.match(/role="radio"/g)).toHaveLength(2);
    expect(h).toContain('aria-checked="true"');
    expect(h).not.toContain('style=');
  });
  it('InfoTip: botón rv-info con nombre accesible e icono de 14 px', () => {
    const h = renderToStaticMarkup(<InfoTip clave={Object.keys(INFO)[0] as InfoClave} />);
    expect(h).toContain('class="rv-info"');
    expect(h).toMatch(/aria-label="Información: /);
    expect(h).toContain('width="14"');
  });
});
