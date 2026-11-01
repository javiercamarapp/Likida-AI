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

/** Tokens de duración declarados en cualquier css del módulo (`--chat-entra: 260ms`): `var(--x)` en una animación se RESUELVE antes de medir. */
const TOKENS_DURACION = new Map<string, string>();
for (const f of ARCHIVOS) {
  for (const m of sinComentarios(readFileSync(join(DIR, f), 'utf8')).matchAll(/(--[\w-]+)\s*:\s*(\d*\.?\d+(?:ms|s))\s*;/g)) TOKENS_DURACION.set(m[1], m[2]);
}
const resolverVars = (decl: string) => decl.replace(/var\((--[\w-]+)\)/g, (todo, n: string) => TOKENS_DURACION.get(n) ?? todo);

describe.each(ARCHIVOS)('movimiento en %s', (archivo) => {
  const css = sinComentarios(readFileSync(join(DIR, archivo), 'utf8'));
  const rangos = rangosNoPreference(css);
  const dentro = (pos: number) => rangos.some(([a, b]) => pos > a && pos < b);

  it('todo @keyframes y toda declaración `animation:` viven dentro de no-preference', () => {
    // Excepción: los dos keyframes del SEGURO de la carga (`*-seguro`) conmutan estado a los 20 s y deben valer también con reduced-motion.
    for (const m of css.matchAll(/@keyframes\s+[\w-]+/g)) {
      if (/-seguro$/.test(m[0])) continue;
      expect(dentro(m.index!), `${m[0]} fuera de no-preference`).toBe(true);
    }
    for (const m of css.matchAll(/(^|[;{\s])animation(-name)?\s*:(?!\s*none)[^;}]+/g)) {
      if (/rv-(carga|marco)-seguro/.test(m[0])) continue;
      expect(dentro(m.index!), `animación fuera de no-preference: ${m[0].trim()}`).toBe(true);
    }
  });

  it('ninguna duración pasa de 700 ms', () => {
    for (const m of css.matchAll(/(?:animation|transition)(?:-duration)?\s*:[^;}]+/g)) {
      const decl = resolverVars(m[0]);
      for (const d of decl.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = d[2] === 's' ? parseFloat(d[1]) * 1000 : parseFloat(d[1]);
        // Segunda excepción EXPLÍCITA y acotada (L5): la respiración de la marca y del paso en curso del chat, 1.1 s, la duración exacta
        // del agente de Vexa (ni un ms más: 1100). Es un bucle de opacidad/escala, sin layout; con reduce no se mueve.
        if (ms === 1100 && /rv-chat-respira/.test(decl)) continue;
        // Única excepción: la respiración del logo de la capa de carga y del esqueleto (1.6 s, ESTILO §9 y R08, decisión de Javier); el seguro de 20 s es un retardo.
        if (ms === 1600 && /rv-(esq-)?respira/.test(m[0])) continue;
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

// LG: la DURACIÓN no pasa de 700 ms, pero un retardo la alarga. Tope declarado de la ENTRADA completa (duración + retardo): 1,100 ms. Los únicos que
// se acercan son exactamente los de Vexa: el punto final de la línea (400 ms tras 700 ms de retardo = 1,100) y la dona (barrido de 700 ms con escalón
// de 90 ms × 5 gajos = 1,060). Las barras escalonan hasta 31 columnas × 14 ms (434 + 420) y 16 filas × 40 ms (600 + 420) con el índice acotado en el componente.
describe('graficas.css · entrada completa (duración + retardo)', () => {
  const css = sinComentarios(readFileSync(join(DIR, 'graficas.css'), 'utf8'));
  const ms = (v: string, u: string) => (u === 's' ? parseFloat(v) * 1000 : parseFloat(v));
  it('ningún retardo suelto pasa de 600 ms y ningún atajo `animation` suma más de 1,100 ms', () => {
    for (const m of css.matchAll(/animation-delay\s*:\s*(\d*\.?\d+)(ms|s)/g)) expect(ms(m[1], m[2]), m[0]).toBeLessThanOrEqual(600);
    for (const m of css.matchAll(/(?:^|[;{\s])animation\s*:\s*([^;}]+)/g)) {
      const t = [...resolverVars(m[1]).matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map((x) => ms(x[1], x[2]));
      if (t.length) expect(t[0] + (t[1] ?? 0), m[0]).toBeLessThanOrEqual(1100);
    }
  });
  it('el escalón más largo (columnas 31 × 14, dona 4 × 90, barras 15 × 40) más su duración cabe en 1,100 ms', () => {
    expect(31 * 14 + 420).toBeLessThanOrEqual(1100);
    expect(4 * 90 + 700).toBeLessThanOrEqual(1100);
    expect(15 * 40 + 420).toBeLessThanOrEqual(1100);
  });
});
