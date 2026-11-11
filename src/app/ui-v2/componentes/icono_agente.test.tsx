import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLAVES_ICONO_AGENTE, IconoAgente } from './icono-agente';

const css = readFileSync(join(__dirname, '..', 'icono-agente.css'), 'utf8');
const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('IconoAgente (SVG animado)', () => {
  it.each(CLAVES_ICONO_AGENTE)('%s: SVG de trazo 1.75 con extremos redondos, decorativo por omisión y sin colores propios', (clave) => {
    const h = renderToStaticMarkup(<IconoAgente agente={clave} />);
    expect(h).toContain('stroke-width="1.75"');
    expect(h).toContain('stroke-linecap="round"');
    expect(h).toContain('stroke="currentColor"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|style=/i);
    expect(h).not.toContain('data-vivo');
  });
  it('con etiqueta es una imagen con nombre (no decorativa)', () => {
    const h = renderToStaticMarkup(<IconoAgente agente="peajes" etiqueta="Peajes" />);
    expect(h).toContain('role="img"');
    expect(h).toContain('aria-label="Peajes"');
    expect(h).not.toContain('aria-hidden');
  });
  it('corriendo marca data-vivo; parado, no', () => {
    expect(renderToStaticMarkup(<IconoAgente agente="liquidacion" vivo />)).toContain('data-vivo="true"');
    expect(renderToStaticMarkup(<IconoAgente agente="liquidacion" />)).not.toContain('data-vivo');
  });
});

describe('icono-agente.css respeta prefers-reduced-motion', () => {
  it('todo @keyframes y toda `animation` viven dentro de no-preference; fuera de él los iconos están quietos y completos', () => {
    const ini = sinComentarios.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(ini).toBeGreaterThan(0);
    const fuera = sinComentarios.slice(0, ini);
    expect(fuera).not.toMatch(/@keyframes|animation|transition|stroke-dasharray/);
    // las piezas «vivo» solo se ven cuando el agente corre y hay movimiento permitido
    expect(fuera).toMatch(/\.rv-ia__vivo\s*\{\s*opacity:\s*0/);
  });
  it('ninguna animación es infinita ni dura más de 700 ms', () => {
    expect(sinComentarios).not.toMatch(/infinite/);
    for (const m of sinComentarios.matchAll(/animation(?:-delay)?\s*:[^;}]+/g)) {
      for (const d of m[0].matchAll(/(\d*\.?\d+)(ms|s)\b/g)) expect(d[2] === 's' ? parseFloat(d[1]) * 1000 : parseFloat(d[1]), m[0]).toBeLessThanOrEqual(700);
    }
  });
});
