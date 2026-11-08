/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio módulo por rutas fijas */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChipFuente, IDS_INTEGRACION, MarcaIntegracion, esIntegracionConocida } from './marca-integracion';
import { INTEGRACIONES } from './marca-integracion.data';

const leer = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const PEDIDOS = ['hubspot', 'zendesk', 'whatsapp', 'outlook', 'microsoft', 'excel', 'csv', 'sap', 'google', 'gmail', 'resend'];

describe('MarcaIntegracion', () => {
  it('trae todos los proveedores pedidos (Microsoft/Outlook, Excel, CSV, SAP, Google, Gmail, Resend, HubSpot, Zendesk, WhatsApp)', () => {
    for (const id of PEDIDOS) expect(IDS_INTEGRACION, id).toContain(id);
  });
  it('cada logo es un solo <path> de viewBox 24 a 16x16 con el color oficial, sin recortar (trazado de simple-icons)', () => {
    for (const id of PEDIDOS.filter((x) => x !== 'csv')) {
      const h = renderToStaticMarkup(<MarcaIntegracion id={id} />);
      expect(h, id).toContain('viewBox="0 0 24 24"');
      expect(h, id).toContain('width="16" height="16"');
      expect(h.match(/<path/g), id).toHaveLength(1);
      const def = INTEGRACIONES[id as keyof typeof INTEGRACIONES];
      expect(def.tipo).toBe('logo');
      if (def.tipo === 'logo') {
        expect(h, id).toContain(`fill="${def.color}"`);
        expect(def.fuente, id).toMatch(/^simple-icons v\d+\.\d+\.\d+$/);
        expect(def.path.length, id).toBeGreaterThan(50);
      }
    }
  });
  it('CSV usa un icono genérico de lucide, no un trazado de marca', () => {
    const h = renderToStaticMarkup(<MarcaIntegracion id="csv" />);
    expect(h).toContain('lucide');
    expect(INTEGRACIONES.csv.tipo).toBe('generico');
  });
  it('un id desconocido cae al icono genérico, nunca a un logo inventado', () => {
    expect(esIntegracionConocida('hubspot')).toBe(true);
    expect(esIntegracionConocida('toString')).toBe(false); // no hereda de Object.prototype
    const h = renderToStaticMarkup(<MarcaIntegracion id="no-existe" />);
    expect(h).toContain('lucide');
    expect(h).toContain('data-marca="desconocida"');
    expect(h).not.toContain('fill="#');
  });
  it('accesibilidad: decorativo por omisión (aria-hidden); con etiqueta es role=img con nombre', () => {
    expect(renderToStaticMarkup(<MarcaIntegracion id="sap" />)).toContain('aria-hidden="true"');
    const h = renderToStaticMarkup(<MarcaIntegracion id="sap" etiqueta="SAP" />);
    expect(h).toContain('role="img"');
    expect(h).toContain('aria-label="SAP"');
    expect(h).not.toContain('aria-hidden');
  });
  it('tam cambia el lado', () => {
    expect(renderToStaticMarkup(<MarcaIntegracion id="gmail" tam={20} />)).toContain('width="20" height="20"');
  });
  it('las marcas que no contrastan 3:1 con la superficie oscura pasan a tinta en oscuro (Zendesk, Resend, Microsoft); las vivas no', () => {
    for (const id of ['zendesk', 'resend', 'microsoft'] as const) expect(renderToStaticMarkup(<MarcaIntegracion id={id} />), id).toContain('data-mono-oscuro');
    for (const id of ['hubspot', 'whatsapp', 'google'] as const) expect(renderToStaticMarkup(<MarcaIntegracion id={id} />), id).not.toContain('data-mono-oscuro');
  });
  it('los colores de marca viven SOLO en el .data.ts: ni el .tsx ni piezas.css los repiten', () => {
    const fuentes = [leer('marca-integracion.tsx'), readFileSync(join(__dirname, '..', 'piezas.css'), 'utf8').split('Marcas de integración')[1] ?? ''];
    for (const f of fuentes) for (const def of Object.values(INTEGRACIONES)) if (def.tipo === 'logo') expect(f.toLowerCase()).not.toContain(def.color.toLowerCase());
  });
  it('es una pieza pura: sin "use client" ni funciones que cruzar la frontera', () => {
    expect(leer('marca-integracion.tsx')).not.toMatch(/^['"]use client['"]/m);
  });
});

describe('ChipFuente', () => {
  it('sin onClick es un <span> informativo con el logo y el texto', () => {
    const h = renderToStaticMarkup(<ChipFuente marca="hubspot">HubSpot</ChipFuente>);
    expect(h).toMatch(/^<span class="rv-chipfuente"/);
    expect(h).toContain('data-marca="hubspot"');
    expect(h).toContain('HubSpot</span>');
    expect(h).not.toContain('aria-pressed');
  });
  it('con onClick es un <button> con aria-pressed; activo marca data-activo', () => {
    const inactivo = renderToStaticMarkup(<ChipFuente marca="excel" onClick={() => {}}>Excel</ChipFuente>);
    expect(inactivo).toMatch(/^<button type="button"/);
    expect(inactivo).toContain('aria-pressed="false"');
    expect(inactivo).not.toContain('data-activo');
    const activo = renderToStaticMarkup(<ChipFuente marca="excel" activo onClick={() => {}}>Excel</ChipFuente>);
    expect(activo).toContain('aria-pressed="true"');
    expect(activo).toContain('data-activo');
  });
  it('sin marca solo pinta el texto', () => {
    expect(renderToStaticMarkup(<ChipFuente>Todas</ChipFuente>)).not.toContain('<svg');
  });
  it('CSS: píldora de 28 px, padding 0 10, radio 999, 12/500, borde 1 px #d6d6d9 (--line2), aire 6; activo con los tokens --seg-activo-*', () => {
    const css = readFileSync(join(__dirname, '..', 'piezas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const base = /\[data-ui="v2"\] \.rv-chipfuente \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const re of [/height:\s*28px/, /padding:\s*0 10px/, /border-radius:\s*999px/, /font:\s*500 12px/, /border:\s*1px solid var\(--line2\)/, /gap:\s*6px/]) expect(base).toMatch(re);
    const activo = /\.rv-chipfuente\[data-activo\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const t of ['--seg-activo-bg', '--seg-activo-borde', '--seg-activo-fg']) expect(activo).toContain(t);
    expect(readFileSync(join(__dirname, '..', 'tokens.css'), 'utf8')).toMatch(/--line2:\s*#d6d6d9/);
  });
});
