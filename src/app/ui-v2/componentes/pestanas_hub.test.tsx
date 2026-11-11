import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarcoPagina } from './marco-pagina';
import { PestanasHub, ProveedorPestanasHub, type PestanaHub } from './pestanas-hub';

const seis: PestanaHub[] = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'].map((nombre, i) => ({ href: `/x/${i}`, nombre }));

describe('PestanasHub', () => {
  it('pinta conteo y atención por pestaña; un cero es gris y la ausencia de dato no pinta número', () => {
    const html = renderToStaticMarkup(
      <PestanasHub etiqueta="Secciones" actual="/x/0" pestanas={[
        { href: '/x/0', nombre: 'Uno', conteo: 3, atencion: true }, { href: '/x/1', nombre: 'Dos', conteo: 0, atencion: true }, { href: '/x/2', nombre: 'Tres', conteo: null },
      ]} />,
    );
    expect(html).toMatch(/Uno<span class="rv-tabs__conteo" data-atencion="true">3</);
    expect(html).toMatch(/Dos<span class="rv-tabs__conteo" data-cero="true">0</);
    expect(html).not.toMatch(/Tres<span/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it('menos de 2 pestañas no pinta barra', () => {
    expect(renderToStaticMarkup(<PestanasHub etiqueta="s" actual="/x/0" pestanas={[seis[0]]} />)).toBe('');
  });
  it('con 6 pestañas la fila desplaza por dentro: cada pestaña no se encoge y la lista tiene overflow-x (sin scroll de página a 360 px)', () => {
    const html = renderToStaticMarkup(<PestanasHub etiqueta="s" actual="/x/0" pestanas={seis} />);
    expect(html.match(/rv-tabs__tab/g)).toHaveLength(6);
    const css = readFileSync(join(__dirname, '..', 'piezas.css'), 'utf8');
    expect(css).toMatch(/\.rv-tabs \{[^}]*overflow-x: auto/);
    expect(css).toMatch(/\.rv-tabs__tab \{[^}]*flex: none[^}]*white-space: nowrap/);
    const shell = readFileSync(join(__dirname, '..', '..', 'admin', 'admin-shell.css'), 'utf8');
    expect(shell).toMatch(/\.rv-marco > \.rv-marco__pestanas \{[^}]*min-width: 0/);
  });
});

describe('MarcoPagina + pestañas', () => {
  const valor = { etiqueta: 'Secciones de X', actual: '/x/1', pestanas: seis };
  it('sin proveedor no pinta barra (otras áreas intactas)', () => {
    expect(renderToStaticMarkup(<MarcoPagina titulo="T" />)).not.toContain('<nav');
  });
  it('con proveedor la pinta entre el encabezado y el cuerpo', () => {
    const html = renderToStaticMarkup(<ProveedorPestanasHub valor={valor}><MarcoPagina titulo="T"><section>cuerpo</section></MarcoPagina></ProveedorPestanasHub>);
    const main = html.slice(html.indexOf('<main'));
    expect(main.indexOf('</header>')).toBeLessThan(main.indexOf('rv-marco__pestanas'));
    expect(main.indexOf('rv-marco__pestanas')).toBeLessThan(main.indexOf('<section>cuerpo'));
  });
});
