import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Drawer, Modal } from './index';

describe('Drawer / Modal', () => {
  it('Drawer: <dialog> nativo cerrado, nombrado por su título, con botón Cerrar y grabber', () => {
    const html = renderToStaticMarkup(<Drawer abierto={false} onCerrar={() => {}} titulo="Cómo conseguirlo" descripcion="Pasos">cuerpo</Drawer>);
    expect(html.startsWith('<dialog')).toBe(true);
    expect(html).not.toMatch(/<dialog[^>]* open/);
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain('aria-describedby');
    expect(html).toContain('aria-label="Cerrar"');
    expect(html).toContain('rv-ov__grabber');
    expect(html).toContain('Cómo conseguirlo');
  });
  it('Modal: sin descripción no declara aria-describedby; pie opcional', () => {
    const html = renderToStaticMarkup(<Modal abierto={false} onCerrar={() => {}} titulo="Confirmar" pie={<b>ok</b>}>x</Modal>);
    expect(html).not.toContain('aria-describedby');
    expect(html).toContain('rv-ov__pie');
    expect(html).toContain('data-tamano="m"');
  });
  it('CSS: la salida no se anima (no hay keyframes de cierre) y la entrada ≤ 180 ms', () => {
    const css = readFileSync(join(__dirname, '..', 'componentes.css'), 'utf8');
    expect(css).not.toMatch(/rv-ov[^{]*:not\(\[open\]\)[^{]*\{[^}]*animation/);
    expect(readFileSync(join(__dirname, '..', 'movimiento.css'), 'utf8')).toContain('--ov-in: 180ms');
  });

  it('marca al pie del Drawer (.rv-ov__marca): el logo oficial, decorativo, solo en escritorio y nunca en el Modal', () => {
    const drawer = renderToStaticMarkup(<Drawer abierto={false} onCerrar={() => {}} titulo="Detalle">x</Drawer>);
    const modal = renderToStaticMarkup(<Modal abierto={false} onCerrar={() => {}} titulo="Confirmar">x</Modal>);
    const marca = /<div class="rv-ov__marca" aria-hidden="true">(.*?)<\/div>/.exec(drawer);
    expect(marca, 'el Drawer debe pintar .rv-ov__marca').not.toBeNull();
    expect(marca?.[1]).toContain('viewBox="0 0 726 149"'); // el logo horizontal completo, no un símbolo recortado
    expect(marca?.[1]).not.toContain('aria-label'); // decorativo: el lector de pantalla no lo anuncia
    expect(modal).not.toContain('rv-ov__marca');
    const css = readFileSync(join(__dirname, '..', 'componentes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.rv-ov__marca \{[^}]*border-top: 1px solid var\(--line\)[^}]*color: var\(--ink\)/); // hereda la tinta: claro y oscuro
    expect(css).toMatch(/@media \(max-width: 819px\) \{ \[data-ui="v2"\] \.rv-ov__marca \{ display: none; \} \}/); // la hoja inferior móvil no la lleva
  });
});
