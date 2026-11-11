/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS fuente del propio repo */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui-v2/paginas.css', import.meta.url), 'utf8');

describe('Portada cinco_agentes: el chip de estado cabe en la tarjeta del agente (1440 px)', () => {
  it('la fila icono + chip envuelve y el chip puede crecer en alto con su texto (no pastilla fija nowrap)', () => {
    expect(css).toMatch(/\.rv-ic__estado\s*\{[^}]*flex-wrap:\s*wrap/);
    const regla = css.match(/\.rv-ic__estado > \.rv-estado\s*\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    expect(regla![1]).toMatch(/height:\s*auto/);
    expect(regla![1]).toMatch(/white-space:\s*normal/);
    expect(regla![1]).toMatch(/min-width:\s*0/);
  });
});
