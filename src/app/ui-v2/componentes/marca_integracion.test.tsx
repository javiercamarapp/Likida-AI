/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio módulo por rutas fijas */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChipFuente, IDS_INTEGRACION, MarcaIntegracion, esIntegracionConocida, type MarcaId } from './marca-integracion';
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
  it("'generico' y cualquier id sin marca caen al icono genérico, nunca a un logo inventado", () => {
    expect(esIntegracionConocida('hubspot')).toBe(true);
    expect(esIntegracionConocida('toString')).toBe(false); // no hereda de Object.prototype
    for (const id of ['generico', 'no-existe']) {
      const h = renderToStaticMarkup(<MarcaIntegracion id={id as MarcaId} />);
      expect(h).toContain('lucide');
      expect(h).toContain('data-marca="generico"');
      expect(h).not.toContain('fill="#');
    }
  });
  it('accesibilidad: siempre decorativo (aria-hidden), el nombre va escrito al lado', () => {
    for (const id of ['sap', 'csv', 'generico'] as const) expect(renderToStaticMarkup(<MarcaIntegracion id={id} />), id).toContain('aria-hidden="true"');
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

describe('ChipFuente (píldora tipo casilla, sin JavaScript)', () => {
  it('renderiza <label> con <input type="checkbox"> name/value, el logo y la etiqueta', () => {
    const h = renderToStaticMarkup(<ChipFuente id="hubspot" etiqueta="HubSpot" name="fuente" value="hubspot" />);
    expect(h).toMatch(/^<label class="rv-chipfuente"/);
    expect(h).toContain('type="checkbox"');
    expect(h).toContain('name="fuente"');
    expect(h).toContain('value="hubspot"');
    expect(h).toContain('data-marca="hubspot"');
    expect(h).toContain('>HubSpot</span>');
    expect(h).not.toContain('checked');
  });
  it('activo = defaultChecked; deshabilitado = disabled', () => {
    expect(renderToStaticMarkup(<ChipFuente id="excel" etiqueta="Excel" activo />)).toContain('checked=""');
    const d = renderToStaticMarkup(<ChipFuente id="csv" etiqueta="CSV" deshabilitado />);
    expect(d).toContain('disabled=""');
    expect(d).toContain('data-deshabilitado');
  });
  it('sin props de función: sirve en un componente de servidor dentro de un <form method="get">', () => {
    const h = renderToStaticMarkup(<form method="get"><ChipFuente id="gmail" etiqueta="Gmail" name="f" value="gmail" activo /></form>);
    expect(h).toContain('<form method="get">');
    expect(readFileSync(join(__dirname, 'marca-integracion.tsx'), 'utf8')).not.toMatch(/onClick|onChange|=>\s*void/);
  });
  it('CSS: píldora de 28 px, padding 0 10, radio 999, 12/500, borde 1 px #d6d6d9 (--line2), aire 6; marcado con los tokens --seg-activo-*', () => {
    const css = readFileSync(join(__dirname, '..', 'piezas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const base = /\[data-ui="v2"\] \.rv-chipfuente \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const re of [/height:\s*28px/, /padding:\s*0 10px/, /border-radius:\s*999px/, /font:\s*500 12px/, /border:\s*1px solid var\(--line2\)/, /gap:\s*6px/]) expect(base).toMatch(re);
    const activo = /\.rv-chipfuente:has\(\.rv-chipfuente__in:checked\) \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const t of ['--seg-activo-bg', '--seg-activo-borde', '--seg-activo-fg']) expect(activo).toContain(t);
    expect(readFileSync(join(__dirname, '..', 'tokens.css'), 'utf8')).toMatch(/--line2:\s*#d6d6d9/);
  });
});
