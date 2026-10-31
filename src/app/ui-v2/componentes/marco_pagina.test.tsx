import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Boton, EncabezadoPagina, EstadoError, EstadoVacio, MarcoPagina, ProveedorAreaV2, Tarjeta } from './index';
import { EsqCifrasV2, EsqPagina, EsqTablaV2, EsqTarjetaV2 } from './esqueleto';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

describe('EncabezadoPagina (único)', () => {
  it('etiqueta del área sobre el h1, una línea de apoyo y las acciones a la derecha', () => {
    const html = renderToStaticMarkup(<EncabezadoPagina area="Operación" titulo="Viajes" apoyo="El registro de viajes." acciones={<Boton>Nuevo</Boton>} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.indexOf('Operación')).toBeLessThan(html.indexOf('<h1'));
    expect(html).toContain('rv-encabezado__desc');
    expect(html).toContain('rv-encabezado__acciones');
  });

  it('sin `area`, la etiqueta sale del menú (contexto del marco); sin contexto, no se inventa ninguna', () => {
    const conMenu = renderToStaticMarkup(<ProveedorAreaV2 value="Dinero y fiscal"><EncabezadoPagina titulo="Facturación a clientes" /></ProveedorAreaV2>);
    expect(conMenu).toContain('Dinero y fiscal');
    expect(renderToStaticMarkup(<EncabezadoPagina titulo="Viajes" />)).not.toContain('rv-encabezado__rotulo');
  });

  it('`area` explícita gana sobre la del menú (detalles que no están en el menú)', () => {
    const html = renderToStaticMarkup(<ProveedorAreaV2 value="Operación"><EncabezadoPagina area="Viajes" titulo="Liquidación del viaje X" /></ProveedorAreaV2>);
    expect(html).toContain('Viajes');
    expect(html).not.toContain('Operación');
  });

  it('el h1 puede llevar id para nombrar la región principal', () => {
    const html = renderToStaticMarkup(<MarcoPagina titulo="Próximamente" idTitulo="t-1" />);
    expect(html).toContain('<h1 id="t-1"');
    expect(html).toContain('aria-labelledby="t-1"');
  });
});

describe('MarcoPagina (único)', () => {
  it('un <main> con el encabezado y los bloques hijos; sin style en línea', () => {
    const html = renderToStaticMarkup(<MarcoPagina titulo="Viajes" apoyo="x"><section>cuerpo</section></MarcoPagina>);
    expect(html).toMatch(/^<main class="rv-marco"/);
    expect(html).toContain('<section>cuerpo</section>');
    expect(html).not.toContain('style=');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('`ancho="lectura"` queda marcado para limitar el ancho por CSS', () => {
    expect(renderToStaticMarkup(<MarcoPagina titulo="Legal" ancho="lectura" />)).toContain('data-ancho="lectura"');
  });
});

describe('Tarjeta: los mismos estados en todo el producto', () => {
  it('vacío: título + una línea + UNA acción', () => {
    const html = renderToStaticMarkup(<Tarjeta titulo="Peajes" estado="vacio" mensaje="Sin cruces" detalle="Cuando haya estados de cuenta, aquí verás los cruces." accionVacio={<Boton>Cargar estado de cuenta</Boton>} />);
    expect(html).toContain('Sin cruces');
    expect(html).toContain('Cuando haya estados de cuenta');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain('rv-tarjeta__error');
  });

  it('error: blando, «No disponible ahora», «No es cero» y Reintentar', () => {
    const html = renderToStaticMarkup(<Tarjeta titulo="Peajes" estado="error" onReintentar={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('No disponible ahora');
    expect(html).toContain('No es cero');
    expect(html).toContain('Reintentar');
  });

  it('cargando con esqueleto: pinta el esqueleto y no los datos', () => {
    const html = renderToStaticMarkup(<Tarjeta titulo="Peajes" estado="cargando" esqueleto={<EsqTablaV2 filas={2} />}><p>DATOS</p></Tarjeta>);
    expect(html).toContain('rv-esq-fila');
    expect(html).not.toContain('DATOS');
    expect(html).toContain('aria-busy="true"');
  });
});

describe('EstadoVacio / EstadoError', () => {
  it('el vacío no lleva ilustración, y la pantalla vacía se marca aparte', () => {
    const h = renderToStaticMarkup(<EstadoVacio pantalla titulo="Sin novedades">Nada pide a una persona.</EstadoVacio>);
    expect(h).toContain('data-pantalla="true"');
    expect(h).not.toContain('<svg');
  });
  it('el error dice que no es cero y ofrece la salida', () => {
    const h = renderToStaticMarkup(<EstadoError reintentar>No se pudo leer.</EstadoError>);
    expect(h).toContain('No disponible ahora');
    expect(h).toContain('role="alert"');
  });
});

describe('Esqueletos con la forma real', () => {
  it('sin style en línea (CSP con nonce) y con rol de estado accesible', () => {
    for (const el of [<EsqPagina key="p" />, <EsqCifrasV2 key="c" n={4} />, <EsqTarjetaV2 key="t" alto={160} />, <EsqTablaV2 key="b" filas={3} />]) {
      const h = renderToStaticMarkup(el);
      expect(h).not.toContain('style=');
      expect(h).toContain('role="status"');
      expect(h).toContain('aria-label="Cargando"');
    }
  });
  it('la tira de esqueleto tiene la misma estructura que TiraCifras (celdas rv-kpi dentro de rv-kpis)', () => {
    const h = renderToStaticMarkup(<EsqCifrasV2 n={5} />);
    expect(h.split('class="rv-kpi"').length - 1).toBe(5);
  });
  it('el esqueleto de página lleva la marca de carga de página y no el logo', () => {
    const h = renderToStaticMarkup(<EsqPagina />);
    expect(h).toContain('data-carga="pagina"');
    expect(h).not.toContain('<svg');
  });
});
