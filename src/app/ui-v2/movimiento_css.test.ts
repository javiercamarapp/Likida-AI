/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// E-09 (PLAN §4): el movimiento nuevo cumple la regla o CI falla.
const DIR = __dirname;
const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith('.css') && f !== 'tokens.css' && f !== 'fonts.css');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Rangos [ini, fin) del texto cubiertos por bloques @media (...no-preference...). */
function rangosNoPreference(css: string): Array<[number, number]> {
  const r: Array<[number, number]> = [];
  const re = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let prof = 1;
    let i = re.lastIndex;
    while (i < css.length && prof > 0) {
      if (css[i] === '{') prof++;
      else if (css[i] === '}') prof--;
      i++;
    }
    r.push([m.index, i]);
  }
  return r;
}

describe.each(ARCHIVOS)('movimiento en %s', (archivo) => {
  const css = sinComentarios(readFileSync(join(DIR, archivo), 'utf8'));
  const rangos = rangosNoPreference(css);
  const dentro = (pos: number) => rangos.some(([a, b]) => pos > a && pos < b);

  it('todo @keyframes y toda declaración `animation:` viven dentro de no-preference', () => {
    for (const m of css.matchAll(/@keyframes\s+[\w-]+/g)) {
      expect(dentro(m.index!), `${m[0]} fuera de no-preference`).toBe(true);
    }
    for (const m of css.matchAll(/(^|[;{\s])animation(-name)?\s*:(?!\s*none)[^;}]+/g)) {
      expect(dentro(m.index!), `animación fuera de no-preference: ${m[0].trim()}`).toBe(true);
    }
  });

  it('ninguna duración pasa de 700 ms', () => {
    for (const m of css.matchAll(/(?:animation|transition)(?:-duration)?\s*:[^;}]+/g)) {
      for (const d of m[0].matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = d[2] === 's' ? parseFloat(d[1]) * 1000 : parseFloat(d[1]);
        // Única excepción: la respiración del logo de la capa de carga (1.6 s, ESTILO §9, decisión de Javier); el seguro de 20 s es un retardo.
        if (ms === 1600 && /rv-respira/.test(m[0])) continue;
        expect(ms, m[0]).toBeLessThanOrEqual(700);
      }
    }
  });

  it('ninguna curva con sobreimpulso (y fuera de 0..1)', () => {
    for (const m of css.matchAll(/cubic-bezier\(([^)]+)\)/g)) {
      const [, y1, , y2] = m[1].split(',').map((x) => parseFloat(x));
      expect(y1, m[0]).toBeGreaterThanOrEqual(0);
      expect(y1, m[0]).toBeLessThanOrEqual(1);
      expect(y2, m[0]).toBeGreaterThanOrEqual(0);
      expect(y2, m[0]).toBeLessThanOrEqual(1);
    }
  });

  it('sin blur de filtro en el movimiento', () => {
    expect(css).not.toMatch(/filter\s*:\s*blur/);
  });
});

describe('movimiento.css', () => {
  const css = readFileSync(join(DIR, 'movimiento.css'), 'utf8');
  it('declara los tokens de la escala y la curva única', () => {
    for (const t of ['--ui-fast: 120ms', '--ui-motion: 180ms', '--ui-slow: 250ms', '--ui-ease: cubic-bezier(.22, 1, .36, 1)']) {
      expect(css).toContain(t);
    }
  });
  it('trae la regla global de reduced-motion', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none\s*!important/);
  });
});
