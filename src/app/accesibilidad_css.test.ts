import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// F8 / CT-PAR-11: el respaldo de accesibilidad de globals.css no se pierde en una limpieza.
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('respaldo de accesibilidad en globals.css', () => {
  it('los campos de texto tienen anillo de foco con 2 px de contorno', () => {
    const bloque = sinComentarios.match(/input:not\([^{]*:focus-visible[^{]*\{[^}]*\}/);
    expect(bloque, 'falta la regla de :focus-visible para input/select/textarea').not.toBeNull();
    expect(bloque![0]).toContain('outline: 2px solid var(--ink)');
    expect(bloque![0]).toContain('textarea:not(.sr-only');
  });
  it('excluye los campos que no son cuadro de texto, para no pintar anillo en casillas ni botones', () => {
    for (const t of ['checkbox', 'radio', 'file', 'range', 'hidden', 'submit']) expect(sinComentarios).toContain(`[type="${t}"]`);
  });
  it('pulse/bounce/ping se apagan con reduced-motion y spin NO (indicador esencial)', () => {
    const m = sinComentarios.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.animate-pulse[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain('animate-spin');
    for (const c of ['animate-pulse', 'animate-bounce', 'animate-ping']) expect(m![0]).toContain(c);
  });
});
