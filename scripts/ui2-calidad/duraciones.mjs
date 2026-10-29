// c9 · duraciones de movimiento (ESTILO §10). Permitidas: los tokens {120,140,160,170,180,220,250,260,360,380,420,700,1600} ms
// y, en reglas de GRÁFICA (selector con graf|chart|barra|columna|linea|anillo|dona|heat|spark), cualquier valor ≤700 ms.
// Se leen las hojas de ui-v2/*.css (el CSS del producto v2) y los `style=""` del HTML renderizado; los resets de
// reduced-motion (≤ 0.01 ms) y los `0s` no cuentan. Sin dependencias: se ejecuta en Node, no en la página.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const TOKENS_MS = [120, 140, 160, 170, 180, 220, 250, 260, 360, 380, 420, 700, 1600];
export const MAX_GRAFICA_MS = 700;
const GRAFICA = /graf|chart|barra|columna|linea|anillo|dona|heat|spark|trazo|pista/i;
const TIEMPO = /(-?\d*\.?\d+)(ms|s)\b/g;

/** Primera duración (no el retardo) de cada elemento de una lista `a 200ms ease 50ms, b 1s`. */
function duraciones(valor, esLonga) {
  const out = [];
  for (const parte of valor.split(/,(?![^(]*\))/)) {
    const ts = [...parte.matchAll(TIEMPO)].map((m) => Math.round(parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) * 100) / 100);
    if (ts.length) out.push(ts[0]); // en shorthand la 1.ª es la duración y la 2.ª el retardo; en `*-duration` hay una
    void esLonga;
  }
  return out;
}

export function evaluar(ms, selector) {
  if (ms <= 0.1) return true; // reset de reduced-motion
  if (TOKENS_MS.includes(ms)) return true;
  return ms <= MAX_GRAFICA_MS && GRAFICA.test(selector || '');
}

/** Duraciones de todas las hojas `*.css` de `dir` (src/app/ui-v2). Devuelve los hallazgos como texto. */
export function duracionesCss(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const archivos = readdirSync(dir).filter((n) => n.endsWith('.css')).sort();
  const textos = archivos.map((f) => [f, readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);
  // Propiedades personalizadas con un tiempo (--ui-slow: 250ms): se resuelven antes de juzgar cada declaración.
  const vars = {};
  for (const [, css] of textos) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*(-?\d*\.?\d+m?s)\s*[;}]/g)) vars[m[1]] = m[2];
  const resolver = (v) => v.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/g, (_, n, fb) => vars[n] ?? (fb && /\d(ms|s)\b/.test(fb) ? fb : ''));
  for (const [f, css] of textos) {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      for (const d of m[2].matchAll(/(?:^|;)\s*(transition(?:-duration)?|animation(?:-duration)?)\s*:\s*([^;]+)/g)) {
        const prop = d[1];
        if (/^(transition|animation)$/.test(prop) && /^\s*(none|inherit|initial|unset)\s*$/.test(d[2])) continue;
        const valor = resolver(d[2]);
        for (const ms of duraciones(valor, /duration/.test(prop))) if (!evaluar(ms, selector)) out.push(`${f}: ${ms} ms en «${selector.slice(0, 60)}» (${prop})`);
      }
    }
  }
  return out;
}

/** Duraciones en `style="..."` del HTML (barras y líneas de los componentes que aún las ponen en línea). */
export function duracionesInline(html) {
  const out = [];
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    for (const d of m[1].matchAll(/(?:^|;)\s*(transition(?:-duration)?|animation(?:-duration)?)\s*:\s*([^;]+)/g)) {
      for (const ms of duraciones(d[2].replace(/var\([^)]*\)/g, ''), /duration/.test(d[1]))) if (!evaluar(ms, '')) out.push(`${ms} ms en style="" (${d[1]})`);
    }
  }
  return [...new Set(out)];
}
