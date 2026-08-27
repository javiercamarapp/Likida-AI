import { describe, it, expect } from 'vitest';
import { ARTICULOS, articuloPorSlug } from './articulos';

// ═══════════════════════════════════════════════════════════════════════════
// Las reglas EDITORIALES del blog, como pruebas estructurales — corren sobre
// cada artículo nuevo que un agente de crecimiento publique vía PR. Si una
// pieza viola la marca, no compila el merge: el candado es CI, no memoria.
// ═══════════════════════════════════════════════════════════════════════════

function textoCompleto(slug: string): string {
  const a = articuloPorSlug(slug);
  if (!a) throw new Error(`no existe ${slug}`);
  const cuerpos = a.bloques.map((b) => {
    switch (b.t) {
      case 'p': case 'h2': return b.texto;
      case 'ul': return b.items.join(' ');
      case 'cita': return `${b.texto} ${b.fuente}`;
    }
  });
  return [a.titulo, a.resumen, ...cuerpos].join(' ');
}

describe('el blog cumple las reglas editoriales de la casa', () => {
  it('hay artículos y los slugs son únicos y kebab-case', () => {
    expect(ARTICULOS.length).toBeGreaterThanOrEqual(3);
    const slugs = ARTICULOS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) {
      expect(s).toMatch(/^[a-z0-9-]+$/);
      expect(s.startsWith('-') || s.endsWith('-') || s.includes('--'), s).toBe(false);
    }
  });

  it('cada artículo cita su fundamento (jamás una afirmación fiscal sin fuente)', () => {
    for (const a of ARTICULOS) {
      expect(a.fundamento.length, a.slug).toBeGreaterThanOrEqual(1);
      for (const f of a.fundamento) expect(f.trim().length, a.slug).toBeGreaterThan(10);
    }
  });

  it('prohibido "clientes reales": la frase de la casa es "en pláticas"', () => {
    for (const a of ARTICULOS) {
      const t = textoCompleto(a.slug).toLowerCase();
      expect(t, a.slug).not.toContain('clientes reales');
      // Si nombra a GAL o Innovativos, tiene que ser con la frase honesta.
      if (t.includes('grupo gal') || t.includes('innovativos')) {
        expect(t, a.slug).toContain('en pláticas');
      }
    }
  });

  it('prohibido "hasta un X%" (guia-de-marca §4) y prometer la recuperación', () => {
    for (const a of ARTICULOS) {
      const t = textoCompleto(a.slug).toLowerCase();
      expect(t, a.slug).not.toMatch(/hasta un \d/);
      expect(t, a.slug).not.toContain('te recuperamos');
      expect(t, a.slug).not.toContain('garantizamos');
    }
  });

  it('sin guiones largos en el cuerpo (regla de los textos de marketing)', () => {
    for (const a of ARTICULOS) {
      expect(textoCompleto(a.slug), a.slug).not.toContain('—');
    }
  });

  it('fechas ISO válidas y resumen con sustancia', () => {
    for (const a of ARTICULOS) {
      expect(a.fecha, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.resumen.trim().length, a.slug).toBeGreaterThan(40);
    }
  });

  it('articuloPorSlug: encuentra el existente y devuelve null en el inventado', () => {
    expect(articuloPorSlug(ARTICULOS[0].slug)?.slug).toBe(ARTICULOS[0].slug);
    expect(articuloPorSlug('no-existe')).toBeNull();
  });
});
