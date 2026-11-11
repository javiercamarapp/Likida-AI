import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReabrirForma } from './reabrir-forma';

describe('ReabrirForma', () => {
  it('reabrir (borra la liquidación y su PDF) usa la variante de peligro, no el primario', () => {
    const html = renderToStaticMarkup(
      <ReabrirForma accion={async () => null} boton="Reabrir viaje"><input type="checkbox" name="confirmar" /></ReabrirForma>,
    );
    expect(html).toContain('rv-btn--danger');
    expect(html).not.toContain('rv-btn--primary');
    expect(html).toContain('Reabrir viaje');
  });
});
