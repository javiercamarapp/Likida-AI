import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Loading from './loading';
import LoadingCrecimiento from './crecimiento/loading';
import LoadingVendedores from './vendedores/loading';
import LoadingMapa from './mapa-prospectos/loading';

// R9: las pantallas lentas muestran el esqueleto de la página (forma real), no un logo solo; todas heredan el mismo.
it.each([['admin', Loading], ['crecimiento', LoadingCrecimiento], ['vendedores', LoadingVendedores], ['mapa-prospectos', LoadingMapa]])(
  '%s: carga con el esqueleto de página accesible', (_n, C) => {
    const h = renderToStaticMarkup(<C />);
    expect(h).toContain('data-carga="pagina"');
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('rv-kpi');
  });
