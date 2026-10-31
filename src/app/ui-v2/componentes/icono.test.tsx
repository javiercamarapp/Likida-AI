import { Info } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icono } from './index';

describe('Icono', () => {
  it('fija trazo 1.75 y 16 px por omisión, decorativo', () => {
    const h = renderToStaticMarkup(<Icono icono={Info} />);
    expect(h).toContain('stroke-width="1.75"');
    expect(h).toContain('width="16"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain('style=');
  });
  it('con etiqueta es una imagen con nombre; admite 14/18/20', () => {
    const h = renderToStaticMarkup(<Icono icono={Info} tam={20} etiqueta="Atención" />);
    expect(h).toContain('role="img"');
    expect(h).toContain('aria-label="Atención"');
    expect(h).toContain('width="20"');
    expect(h).not.toContain('aria-hidden');
  });
});
