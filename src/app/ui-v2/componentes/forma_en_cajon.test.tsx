import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormaEnCajon } from './index';

describe('FormaEnCajon · servidor', () => {
  const accion = async () => null;
  it('pinta el disparador, el <form> con su id y el botón de envío del pie unido por form=', () => {
    const h = renderToStaticMarkup(<FormaEnCajon id="alta" titulo="Nuevo cliente" accion={accion} boton="Crear cliente" disparador="Nuevo cliente"><input name="nombre" aria-label="Nombre" /></FormaEnCajon>);
    expect(h).toContain('aria-haspopup="dialog"');
    expect(h).toContain('data-forma-cajon="alta"');
    const id = /<form id="([^"]+)"/.exec(h)?.[1];
    expect(id).toBeTruthy();
    expect(h).toContain(`type="submit" form="${id}"`);
    expect(h).toContain('Crear cliente');
    expect(h).toMatch(/<dialog[^>]* role="dialog"/);
  });
  it('sin `disparador` no pinta botón de apertura (se abre por ?abrir=)', () => {
    const h = renderToStaticMarkup(<FormaEnCajon id="alta" titulo="T" accion={accion} boton="Guardar"><input name="a" /></FormaEnCajon>);
    expect(h).not.toContain('aria-haspopup');
  });
  it('la región de estado existe desde el primer HTML (un aria-live que nace con su texto no se anuncia) y el aviso también', () => {
    const h = renderToStaticMarkup(<FormaEnCajon id="alta" titulo="T" accion={accion} boton="Guardar"><input name="a" /></FormaEnCajon>);
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-live="polite"');
  });
  it('no usa style= con color ni hex en los archivos nuevos', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const f of ['forma-en-cajon.tsx', 'drawer-abrir.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/style=\{\{/);
      expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
