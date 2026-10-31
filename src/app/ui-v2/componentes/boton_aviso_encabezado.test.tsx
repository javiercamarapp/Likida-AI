import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Aviso, Boton, BotonEnlace, Chip, EncabezadoPagina } from './index';
import { StatusPill } from '@/app/admin/ui/kit';

describe('Boton / BotonEnlace', () => {
  it('renderiza <button> real con el mismo texto y type=button por defecto', () => {
    const html = renderToStaticMarkup(<Boton variante="primary">Guardar</Boton>);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('>Guardar</button>');
  });
  it('v1: conserva las clases del botón de siempre (sin atributo v2 se ve igual)', () => {
    const p = renderToStaticMarkup(<Boton variante="primary">x</Boton>);
    expect(p).toContain('inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium');
    expect(p).toContain('bg-[var(--marca)]');
    const s = renderToStaticMarkup(<Boton>x</Boton>);
    expect(s).toContain('hairline');
    expect(s).toContain('hover:bg-[var(--canvas)]');
  });
  it('loading: deshabilitado, aria-busy y el texto no cambia', () => {
    const html = renderToStaticMarkup(<Boton loading>Enviar</Boton>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Enviar');
  });
  it('enlace interno y externo son <a href> reales', () => {
    expect(renderToStaticMarkup(<BotonEnlace href="/dashboard/x">Ir</BotonEnlace>)).toContain('href="/dashboard/x"');
    expect(renderToStaticMarkup(<BotonEnlace href="https://a.b">Ir</BotonEnlace>)).toContain('href="https://a.b"');
  });
  it('enlace deshabilitado no lleva href y se anuncia deshabilitado', () => {
    const html = renderToStaticMarkup(<BotonEnlace href="/x" deshabilitado>Ir</BotonEnlace>);
    expect(html).not.toContain('href=');
    expect(html).toContain('aria-disabled="true"');
  });
  it('pasa name/value/type submit sin alterarlos (contrato e2e)', () => {
    const html = renderToStaticMarkup(<Boton type="submit" name="paso" value="confirmar">Confirmar</Boton>);
    expect(html).toContain('type="submit"');
    expect(html).toContain('name="paso"');
    expect(html).toContain('value="confirmar"');
  });
});

describe('Chip / StatusPill info / Aviso / Encabezado', () => {
  it('Chip de categoría lleva punto y texto', () => {
    const html = renderToStaticMarkup(<Chip categoria={3}>Peajes</Chip>);
    expect(html).toContain('data-categoria="3"');
    expect(html).toContain('Peajes');
  });
  it('StatusPill acepta tono info con texto (nunca color solo)', () => {
    const html = renderToStaticMarkup(<StatusPill estado="info" />);
    expect(html).toContain('Info');
    expect(html).toContain('var(--infobg, var(--canvas))');
  });
  it('Aviso: error es role=alert; info es status; trae icono y texto', () => {
    expect(renderToStaticMarkup(<Aviso tono="error">Falló</Aviso>)).toContain('role="alert"');
    const info = renderToStaticMarkup(<Aviso titulo="Ojo">Detalle</Aviso>);
    expect(info).toContain('role="status"');
    expect(info).toContain('<svg');
    expect(info).toContain('Detalle');
  });
  it('EncabezadoPagina: un solo h1, descripción y acciones opcionales', () => {
    const html = renderToStaticMarkup(<EncabezadoPagina area="Agente 1" titulo="Liquidación" apoyo="Desglose" acciones={<Boton>Nuevo</Boton>} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Agente 1');
    expect(html).toContain('Nuevo');
    expect(renderToStaticMarkup(<EncabezadoPagina titulo="A" />)).not.toContain('rv-encabezado__acciones');
  });
});
