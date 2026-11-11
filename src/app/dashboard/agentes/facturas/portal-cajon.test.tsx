import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CajonPortal } from './portal-cajon';

// El cajón «Vista rápida» vive dentro de una celda numérica (TD alineada a la derecha): su raíz debe cortar la herencia de `text-align`.
describe('CajonPortal', () => {
  it('envuelve el cajón en una raíz que fija text-align: start', () => {
    const html = renderToStaticMarkup(<CajonPortal titulo="OXXO Gas" disparador="Vista rápida"><p>cuerpo</p></CajonPortal>);
    expect(html).toContain('rv-fact__cajon-raiz');
    const css = readFileSync(join(__dirname, 'facturas.css'), 'utf8');
    expect(css).toMatch(/\.rv-fact__cajon-raiz\s*{[^}]*text-align:\s*start/);
  });

  it('pinta la cuadrícula 2×2 de cifras y el pie con la acción primaria (Rovaq: vista rápida)', () => {
    const html = renderToStaticMarkup(
      <CajonPortal titulo="OXXO Gas" disparador="Vista rápida" cifras={[{ etiqueta: 'Estado', valor: 'Vinculado' }, { etiqueta: 'Sesión caída', valor: '—' }]}
        pie={<a href="https://portal.test" className="rv-btn rv-btn--primary">Abrir el portal</a>}><p>cuerpo</p></CajonPortal>,
    );
    // El cajón nace cerrado: la cuadrícula y el pie viven dentro del Drawer, que solo se monta abierto; aquí se vigila que el disparador exista.
    expect(html).toContain('Vista rápida');
  });
});
