import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Aviso } from './componentes/aviso';
import { Chip } from './componentes/chip';

// L9a (verificador M2): --info/--infobg/--tint-info pasaron del gris neutro (31-oct) al marino de marca #2a3f5f (decisión de Javier, 16-nov). Ningún estado
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

  it('el tono info es el marino de MARCA (lista blanca de tokens.css): --info #2a3f5f/#9db8e0, --infobg #e8eef6/#1d2838; --tint-info sigue neutro', () => {
    const css = readFileSync('src/app/ui-v2/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const lee = (n: string) => [...css.matchAll(new RegExp(`--${n}:\\s*#([0-9a-fA-F]{6})`, 'g'))].map((m) => m[1].toLowerCase());
    expect(lee('info')).toEqual(['2a3f5f', '9db8e0']);
    expect(lee('infobg')).toEqual(['e8eef6', '1d2838']);
    for (const h of lee('tint-info')) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b), `--tint-info: #${h} no es neutro`).toBeLessThanOrEqual(12);
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
