import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EstadoVacio } from './estado-vacio';
import { EstadoVacio as EstadoVacioDashboard } from '@/app/dashboard/estados';

/** React #418 en producción: el texto de EstadoVacio iba en un <p>, y cuando la explicación es larga el envoltorio del dashboard
 *  mete un <details> (que el navegador no admite dentro de un <p>: lo cierra antes). El HTML del servidor y el árbol del navegador
 *  dejaban de coincidir y la hidratación fallaba. Renderizar a string no lo detecta, así que se vigila la estructura directamente. */
describe('EstadoVacio: el texto no va en un <p> (admite bloques como <details>)', () => {
  it('la pieza base envuelve el texto en un div', () => {
    const html = renderToStaticMarkup(<EstadoVacio titulo="t"><details><summary>Ver más</summary>x</details></EstadoVacio>);
    expect(html).toContain('<div class="rv-vacio__texto"><details>');
    expect(html).not.toMatch(/<p[^>]*class="rv-vacio__texto"/);
  });

  it('con una explicación larga, el wrapper del dashboard no deja un <details> dentro de un <p>', () => {
    const largo = 'Explicación muy larga. '.repeat(40);
    const html = renderToStaticMarkup(<EstadoVacioDashboard titulo="t">{largo}</EstadoVacioDashboard>);
    expect(html).toContain('<details');
    // Sin regex (el linter de seguridad rechaza las que retroceden): se recorre cada <p ...> hasta su </p>.
    let desde = 0;
    for (;;) {
      const ini = html.indexOf('<p', desde);
      if (ini < 0) break;
      const sigue = html[ini + 2];
      desde = ini + 2;
      if (sigue !== '>' && sigue !== ' ') continue; // <path>, <polyline>…
      const fin = html.indexOf('</p>', ini);
      expect(html.slice(ini, fin < 0 ? undefined : fin)).not.toContain('<details');
    }
  });
});
