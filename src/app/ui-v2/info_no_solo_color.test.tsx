import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Aviso } from './componentes/aviso';
import { Chip } from './componentes/chip';

// L9a (verificador M2): --info/--infobg/--tint-info pasaron de petróleo a gris neutro (decisión de Javier: sin azul). Ningún estado
// informativo puede depender SOLO del color: cada tono lleva un icono propio y texto. Auditoría de usos en el PR #786.
const TONOS = ['info', 'warn', 'error', 'ok'] as const;

describe('estados informativos sin depender solo del color', () => {
  it('cada tono de Aviso lleva un icono DISTINTO y su texto, y el error es role=alert', () => {
    const iconos = new Set<string>();
    for (const t of TONOS) {
      const html = renderToStaticMarkup(<Aviso tono={t}>Mensaje de prueba</Aviso>);
      expect(html).toContain('Mensaje de prueba');
      const icono = html.match(/lucide-([a-z0-9-]+)/)?.[1];
      expect(icono, `el tono ${t} no trae icono`).toBeTruthy();
      iconos.add(icono!);
      expect(html.includes('role="alert"')).toBe(t === 'error');
    }
    expect(iconos.size).toBe(TONOS.length);
  });

  it('un Chip informativo siempre lleva texto (no es un punto de color)', () => {
    const html = renderToStaticMarkup(<Chip tono="info">En curso</Chip>);
    expect(html).toContain('En curso');
  });

  it('el tono info ya no es de matiz azul: --info/--infobg/--tint-info son grises (sin saturación) en claro y oscuro', () => {
    const css = readFileSync('src/app/ui-v2/tokens.css', 'utf8');
    for (const n of ['info', 'infobg', 'tint-info']) {
      for (const m of css.matchAll(new RegExp(`--${n}:\\s*#([0-9a-fA-F]{6})`, 'g'))) {
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
        expect(Math.max(r, g, b) - Math.min(r, g, b), `--${n}: #${m[1]} no es neutro`).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('marco público: textos largos no desbordan', () => {
  it('B6: la línea de apoyo (que lleva el aviso de pago con folios y nombres largos) rompe palabras largas', () => {
    const css = readFileSync('src/app/ui-v2/marco-publico.css', 'utf8');
    expect(css).toMatch(/\.rv-pub__apoyo\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.rv-pub__titulo\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
